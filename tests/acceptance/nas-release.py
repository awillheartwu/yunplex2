#!/usr/bin/env python3
"""Explicitly authorized real-service acceptance; no production mutation commands.

Configuration and reports live outside the checkout. All destructive operations
require this run's marker, exact paths and Docker label. Python 3.8+ stdlib only.
"""
import argparse
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import sqlite3
import statistics
import subprocess
import sys
import time
import urllib.request
import uuid

LABEL = "com.yunplex.acceptance.scope"


class AcceptanceViolation(RuntimeError):
    """Observed data or continuity violation: no further workload writes."""


def observation_plan(config):
    mode = config.get("observationMode", "full")
    duration = config.get("durationSeconds", 86400)
    if mode not in ("full", "periodic_sync"):
        raise RuntimeError("Expected full or periodic_sync observation mode")
    minimum = 86400 if mode == "full" else 43200
    if not isinstance(duration, int) or duration < minimum:
        raise RuntimeError("Observation duration is below its mode's minimum")
    idle = duration / 2 if mode == "full" else 0
    return duration, idle, math.ceil((duration - idle) / 1800)


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def write(path, value):
    path = Path(path)
    temp = path.with_suffix(path.suffix + ".tmp")
    fd = os.open(str(temp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
    os.replace(str(temp), str(path))


def load(path):
    return json.loads(Path(path).read_text())


def digest(path):
    result = hashlib.sha256()
    with open(str(path), "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


class Acceptance:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.cfg = load(self.root / "run.json")
        self.scope = self.cfg["scope"]
        if load(self.root / "scope.json") != {"scope": self.scope}:
            raise RuntimeError("Scope marker mismatch")
        if self.root.name != self.scope or not self.scope.startswith("yunplex-acceptance-"):
            raise RuntimeError("Unsafe scope directory")
        self.media = Path(self.cfg["mediaRoot"]).resolve()
        if self.media.name != self.scope or self.media == self.root or self.root in self.media.parents:
            raise RuntimeError("Unsafe media directory")
        self.name = self.scope
        self.control = self.root / "control"
        self.data = self.root / "data"

    def docker(self, *args, timeout=90, check=True):
        result = subprocess.run(self.cfg["dockerCommand"] + list(args), stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, timeout=timeout)
        if check and result.returncode:
            # Docker output can contain application data: do not expose it.
            raise RuntimeError("Docker operation failed: " + args[0])
        return result

    def guard(self):
        template = ('{"scope":{{json (index .Config.Labels "' + LABEL + '")}},'
                    '"image":{{json .Image}}}')
        result = json.loads(self.docker("inspect", "--format", template, self.name).stdout)
        if result.get("scope") != self.scope:
            raise RuntimeError("Container scope label mismatch")
        if result.get("image") != self.cfg["image"]:
            raise RuntimeError("Test container is not running the validated candidate image")

    def inspect(self, name=None):
        template = ('{"id":{{json .Id}},"image":{{json .Image}},"status":{{json .State.Status}},'
                    '"startedAt":{{json .State.StartedAt}},"restartCount":{{.RestartCount}},'
                    '"oom":{{.State.OOMKilled}},"exitCode":{{.State.ExitCode}}}')
        return json.loads(self.docker("inspect", "--format", template, name or self.name).stdout)

    def helper(self, command, *args, timeout=360):
        self.guard()
        result = self.docker("exec", self.name, "node", "/acceptance/nas-runtime.mjs", command, *args,
                             timeout=timeout, check=False)
        try:
            payload = json.loads(result.stdout.strip().splitlines()[-1])
        except (ValueError, IndexError):
            raise RuntimeError("Acceptance helper did not return JSON: " + command) from None
        if result.returncode or not payload.get("ok"):
            raise RuntimeError(payload.get("error", "Acceptance helper failed: " + command))
        return payload["result"]

    def record(self, case, **details):
        row = {"at": now(), "case": case, **details}
        with open(str(self.root / "results.jsonl"), "a") as stream:
            stream.write(json.dumps(row, ensure_ascii=False) + "\n")
        os.chmod(str(self.root / "results.jsonl"), 0o600)
        print(json.dumps(row, ensure_ascii=False), flush=True)

    def status(self, **patch):
        path = self.root / "status.json"
        value = load(path) if path.exists() else {"scope": self.scope}
        value.update(patch, updatedAt=now())
        write(path, value)
        return value

    def database(self, query, params=()):
        uri = "file:" + str(self.data / "data.db") + "?mode=ro"
        with sqlite3.connect(uri, uri=True, timeout=2) as conn:
            conn.row_factory = sqlite3.Row
            return [dict(row) for row in conn.execute(query, params)]

    def wait_ready(self, timeout=90):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                if self.inspect()["status"] != "running":
                    raise RuntimeError("Private container exited")
                with urllib.request.urlopen("http://127.0.0.1:%s/api/system/ready" % self.cfg["port"], timeout=3) as response:
                    result = json.load(response)
                if result.get("code") == 0:
                    if (self.data / "data.db").exists():
                        os.chmod(str(self.data / "data.db"), 0o600)
                    return
            except (OSError, ValueError):
                pass
            time.sleep(1)
        raise RuntimeError("Private instance readiness timed out")

    def stop(self):
        self.guard()
        self.docker("stop", "--time", "45", self.name, timeout=60)

    def kill_restart(self):
        self.guard()
        process_query = "const fs=require('node:fs');const ids=fs.readdirSync('/proc').filter(x=>/^\\d+$/.test(x)).filter(x=>{try{return fs.readFileSync('/proc/'+x+'/cmdline','utf8').split('\\0').includes('/app/.output/server/index.mjs')}catch{return false}});if(ids.length!==1)process.exit(1);process.stdout.write(ids[0])"
        old_pid = self.docker("exec", self.name, "node", "-e", process_query).stdout.strip()
        interrupted = self.database("SELECT id,run_id,lease_expires_at FROM source_sync_queue WHERE status='running'")
        self.docker("kill", "--signal", "KILL", self.name)
        write(self.control / "fault.json", {})
        self.docker("start", self.name)
        self.wait_ready()
        started = time.monotonic()
        while time.monotonic() - started < 120:
            if not self.database("SELECT id FROM source_sync_queue WHERE status='running'"):
                new_pid = self.docker("exec", self.name, "node", "-e", process_query).stdout.strip()
                before_expiry = all(row["lease_expires_at"] and now() < row["lease_expires_at"] for row in interrupted)
                if interrupted and not before_expiry:
                    raise RuntimeError("Restart recovery waited for lease expiry instead of settling at startup")
                if any(self.database("SELECT id FROM task_runs WHERE id=? AND status='running'", (row["run_id"],)) for row in interrupted):
                    raise RuntimeError("Interrupted run remained active after restart")
                self.record("restart_queue_settlement", passed=True, waitedSeconds=round(time.monotonic() - started, 2),
                            sameNodePid=old_pid == new_pid, beforeLeaseExpiry=before_expiry,
                            interruptedRequests=len(interrupted))
                return
            time.sleep(1)
        raise RuntimeError("Interrupted source request remained running after its lease expired")

    def fixture(self):
        return load(self.control / "fixture.json")

    def validate_candidate_image(self):
        image, revision = self.cfg["image"], self.cfg["revision"]
        if not re.fullmatch(r"sha256:[a-f0-9]{64}", image) or not re.fullmatch(r"[a-f0-9]{40}", revision):
            raise RuntimeError("Candidate requires an immutable image ID and full revision")
        metadata = json.loads(self.docker("image", "inspect", image).stdout)[0]
        labels = metadata.get("Config", {}).get("Labels") or {}
        if (metadata.get("Id") != image or metadata.get("Os") != "linux"
                or metadata.get("Architecture") != "amd64"
                or labels.get("org.opencontainers.image.revision") != revision):
            raise RuntimeError("Candidate image identity, platform or revision does not match")

    def bootstrap(self):
        self.validate_candidate_image()
        self.status(status="preparing", image=self.cfg["image"])
        donor = Path(self.cfg["donorData"]) / "data.db"
        with sqlite3.connect("file:" + str(donor) + "?mode=ro", uri=True) as conn:
            cfg = json.loads(conn.execute("SELECT value FROM config WHERE key='app'").fetchone()[0])
            seed = conn.execute("SELECT plex_file_path FROM song_identity_bindings WHERE netease_song_id=? AND status='active'",
                                (self.cfg["seedSongId"],)).fetchone()
        if not seed:
            raise RuntimeError("Seed binding unavailable")
        plex = {key: cfg["plex"][key] for key in ("server", "port", "token", "section")}
        minimal = {"plex": plex, "netease": {"cookie": cfg["netease"]["cookie"]}}
        if not plex["token"] or not minimal["netease"]["cookie"]:
            raise RuntimeError("Required approved credentials missing")
        for folder in (self.data, self.control, self.root / "bootstrap", self.root / "backups"):
            folder.mkdir(mode=0o700)
        self.media.mkdir(mode=0o755)
        seed_path = Path(seed[0])
        prefix = cfg["download"].get("plexLibraryPathPrefix", "").rstrip("/")
        if prefix and str(seed_path).startswith(prefix + "/"):
            seed_path = Path(self.cfg["donorMusic"]) / str(seed_path)[len(prefix) + 1:]
        elif str(seed_path).startswith(cfg["download"]["dir"].rstrip("/") + "/"):
            seed_path = Path(self.cfg["donorMusic"]) / str(seed_path)[len(cfg["download"]["dir"].rstrip("/")) + 1:]
        if not seed_path.is_file() or Path(self.cfg["donorMusic"]).resolve() not in seed_path.resolve().parents:
            raise RuntimeError("Seed is not a regular file inside approved music mount")
        seed_dir = self.media / "seed"
        seed_dir.mkdir(mode=0o755)
        clone = seed_dir / seed_path.name
        shutil.copyfile(str(seed_path), str(clone))
        clone.chmod(0o644)
        write(self.root / "seed-proof.json", {"source": str(seed_path), "sha256": digest(seed_path), "clone": str(clone)})
        seed_db = self.root / "bootstrap" / "seed.db"
        with sqlite3.connect(str(seed_db)) as conn:
            conn.execute("CREATE TABLE connection(value TEXT NOT NULL)")
            conn.execute("INSERT INTO connection VALUES(?)", (json.dumps(minimal),))
        seed_db.chmod(0o600)
        from urllib.parse import urlparse
        parsed = urlparse(plex["server"] if "://" in plex["server"] else "http://" + plex["server"])
        upstream = "%s://%s:%s" % (parsed.scheme, parsed.hostname, plex["port"])
        write(self.control / "upstream.json", {"url": upstream})
        write(self.control / "fixture.json", {"scope": self.scope, "title": "YunPlex Acceptance " + self.scope,
              "mediaRoot": str(self.media), "playlistId": self.cfg["playlistId"]})
        mounts = [(self.data, "/app/data", "rw"), (self.media, "/mnt/acceptance", "rw"),
                  (self.root / "helpers", "/acceptance", "ro"), (self.control, "/control", "rw"),
                  (self.root / "bootstrap", "/bootstrap", "ro")]
        args = ["run", "-d", "--name", self.name, "--label", LABEL + "=" + self.scope, "--init",
                "--restart", "no", "--user", self.cfg["uidGid"], "--read-only", "--cap-drop", "ALL",
                "--security-opt", "no-new-privileges", "--pids-limit", "256", "--memory", "1g",
                "--tmpfs", "/tmp:rw,nosuid,nodev,mode=1777", "-p", "127.0.0.1:%s:3000" % self.cfg["port"],
                "-e", "NUXT_DATA_DIR=/app/data", "-e", "NITRO_HOST=0.0.0.0", "-e", "NITRO_PORT=3000"]
        for host, target, access in mounts:
            args.extend(["-v", "%s:%s:%s" % (host, target, access)])
        args.extend(["--entrypoint", "/bin/sh", self.cfg["image"], "/acceptance/nas-entrypoint.sh"])
        self.docker(*args)
        self.wait_ready()
        self.record("candidate_image_setup", passed=True, image=self.inspect()["image"],
                    revision=self.cfg["revision"], setup=self.helper("setup"))
        seed_db.unlink()
        result = self.helper("initialize", timeout=600)
        self.record("mixed_quick_initialization", passed=True, result=result)
        write(self.root / "baseline.json", result)
        self.status(status="immediate_tests", stage="baseline_ready")

    def insert_count(self):
        path = self.control / "proxy-mutations.jsonl"
        key = self.fixture()["sourceId"]
        playlist = self.database("SELECT plex_playlist_rating_key AS key FROM playlist_sources WHERE id=?", (key,))[0]["key"]
        rows = [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []
        return sum(row["method"] == "PUT" and row["path"] == "/playlists/%s/items" % playlist for row in rows)

    def uncertain_write(self, mode):
        before = self.helper("snapshot")
        removed = self.helper("remove-one")
        nonce = str(uuid.uuid4())
        write(self.control / "fault.json", {"mode": mode, "nonce": nonce, "playlistKey": removed["playlistKey"]})
        request = self.helper("start")
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            flag = self.control / "fault-reached.json"
            if flag.exists() and load(flag).get("nonce") == nonce:
                break
            time.sleep(0.05)
        else:
            raise RuntimeError("Fault injection point was not reached")
        state = self.helper("snapshot")
        expected_count = 2 if mode == "hold_insert_response" else 1
        if not state["journal"] or state["journal"]["acknowledged"] or len(state["items"]) != expected_count:
            raise RuntimeError("Fault preconditions not established")
        submitted = self.insert_count()
        self.kill_restart()
        after = self.helper("sync", "full", "any")
        if mode == "hold_insert_response":
            if after["request"]["run_status"] != "success" or after["state"]["journal"] or len(after["items"]) != 2:
                raise RuntimeError("Committed write was not recovered by readback")
            if self.insert_count() != submitted:
                raise RuntimeError("Committed insert was sent twice")
        else:
            if after["request"]["run_status"] == "success" or not after["state"]["journal"] or len(after["items"]) != 1:
                raise RuntimeError("Unknown write was incorrectly cleared or repeated")
            if self.insert_count() != submitted:
                raise RuntimeError("Unknown write was resent")
            saved = self.helper("save-settings")
            if not saved["journal"]:
                raise RuntimeError("Ordinary settings save cleared unknown write")
            self.helper("confirm-target")
            after = self.helper("sync")
            if len(after["items"]) != 2 or self.insert_count() != submitted + 1:
                raise RuntimeError("Explicit target confirmation did not reconcile once")
        if before["files"] != after["files"]:
            raise RuntimeError("Playlist reconciliation changed music files")
        self.record(mode, passed=True, interruptedRequest=request["requestId"], fault=load(self.control / "fault-reached.json"),
                    preKill=state, recovered=after, noBlindResend=True)

    def download_interrupt(self):
        before = self.helper("snapshot")
        existing = {task["id"] for task in before["tasks"]}
        pid = self.helper("sample")["pid"]
        request = self.helper("start", "redownload_managed")
        deadline = time.monotonic() + 120
        interrupted = None
        while time.monotonic() < deadline:
            tasks = self.database("SELECT id,status,operation,target_path,execution_intent_json FROM download_tasks WHERE status IN ('downloading','tagging')")
            for task in tasks:
                if task["id"] not in existing:
                    self.guard()
                    self.docker("exec", self.name, "kill", "-STOP", str(pid))
                    frozen = self.database("SELECT id,status,operation,target_path,execution_intent_json FROM download_tasks WHERE id=?", (task["id"],))[0]
                    if frozen["status"] not in ("downloading", "tagging"):
                        self.docker("exec", self.name, "kill", "-CONT", str(pid))
                        raise RuntimeError("Missed active-download interruption window")
                    interrupted = frozen
                    break
            if interrupted:
                break
            time.sleep(0.02)
        if not interrupted or interrupted["operation"] != "replace":
            raise RuntimeError("Managed replacement was not interrupted while active")
        preserved = [{"path": row["path"], "unchanged": digest(self.media / row["path"]) == row["sha256"]} for row in before["files"]]
        if not all(row["unchanged"] for row in preserved):
            raise RuntimeError("Original file changed before replacement validated")
        self.kill_restart()
        recovered = self.helper("state")
        task = next(row for row in recovered["tasks"] if row["id"] == interrupted["id"])
        if task["status"] != "failed" or task["error_code"] != "scheduler_interrupted":
            raise RuntimeError("Interrupted download was not durably classified")
        failures = [row["id"] for row in recovered["failures"] if row["status"] == "open" and interrupted["id"] in (row["download_task_ids"] or "")]
        if not failures:
            raise RuntimeError("Interrupted download has no selectable failure record")
        self.helper("retry", *failures)
        deadline = time.monotonic() + 240
        while time.monotonic() < deadline:
            current = self.helper("state")
            selected = next(row for row in current["tasks"] if row["id"] == interrupted["id"])
            if selected["status"] == "done":
                break
            time.sleep(2)
        else:
            raise RuntimeError("Selected interrupted download did not finish after retry")
        intent = selected.get("intent") or {}
        if intent.get("downloadMode") != "replace":
            raise RuntimeError("Retry lost replacement intent")
        final = self.helper("sync")
        if len(final["items"]) != 2 or final["state"]["journal"]:
            raise RuntimeError("Playlist did not recover after download retry")
        self.record("active_replace_kill_and_retry", passed=True, request=request, interruptedTaskId=interrupted["id"],
                    originalFiles=preserved, recoveredTask=task, retriedTask=selected, final=final)

    def maintenance(self, action, argument, check=True):
        self.guard()
        if self.inspect()["status"] == "running":
            raise RuntimeError("Maintenance requires the private app to be stopped")
        result = self.docker("run", "--rm", "--network", "none", "--user", self.cfg["uidGid"], "--read-only",
                             "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--tmpfs", "/tmp:mode=1777",
                             "-v", str(self.root) + ":/verification:rw", "--entrypoint", "node", self.cfg["image"],
                             "/app/maintenance/cli.mjs", action, "/verification/data", argument, timeout=180, check=False)
        if check and result.returncode:
            raise RuntimeError("Isolated maintenance failed: " + action)
        return result

    def backup_restore(self):
        before = self.helper("snapshot")
        self.stop()
        backup = self.maintenance("backup", "/verification/backups")
        # The packaged CLI prints the generated bundle path as plain text.
        bundle_in_container = backup.stdout.strip().splitlines()[-1]
        if not bundle_in_container:
            candidates = list((self.root / "backups").glob("*/manifest.json"))
            if len(candidates) != 1:
                raise RuntimeError("Unable to identify this run's backup bundle")
            bundle_in_container = "/verification/" + str(candidates[0].parent.relative_to(self.root))
        bundle = self.root / Path(bundle_in_container).relative_to("/verification")
        verified = self.maintenance("verify", bundle_in_container)
        bad = self.root / "tampered-backup"
        shutil.copytree(str(bundle), str(bad))
        members = [path for path in bad.rglob("*") if path.is_file() and path.name != "manifest.json"]
        if not members:
            raise RuntimeError("Backup contains no payload")
        with open(str(members[0]), "ab") as stream:
            stream.write(b"acceptance-tamper")
        data_hash = digest(self.data / "data.db")
        rejected_verify = self.maintenance("verify", "/verification/tampered-backup", check=False)
        rejected_restore = self.maintenance("restore", "/verification/tampered-backup", check=False)
        if not rejected_verify.returncode or not rejected_restore.returncode or digest(self.data / "data.db") != data_hash:
            raise RuntimeError("Corrupt backup was accepted or changed target database")
        marker = self.data / "acceptance-after-backup.txt"
        marker.write_text("This disposable marker must disappear after restore")
        restored = self.maintenance("restore", bundle_in_container)
        previous = list(self.root.glob("data.before-restore-*"))
        if marker.exists() or len(previous) != 1 or not (previous[0] / marker.name).exists():
            raise RuntimeError("Atomic restore or retained previous data verification failed")
        self.docker("start", self.name)
        self.wait_ready()
        after = self.helper("sync")
        if len(after["items"]) != 2 or before["files"] != after["files"]:
            raise RuntimeError("Restored app did not preserve playlist and media")
        self.record("backup_tamper_rejection_and_restore", passed=True, verified=json.loads(verified.stdout),
                    previousDataRetained=True, restoreExitedSuccessfully=restored.returncode == 0, result=after)

    def stats(self, name):
        result = self.docker("stats", "--no-stream", "--format", "{{json .}}", name, timeout=20)
        row = json.loads(result.stdout.strip())
        return {key: row.get(key) for key in ("CPUPerc", "MemUsage", "MemPerc", "PIDs", "NetIO", "BlockIO")}

    def health(self, base):
        with urllib.request.urlopen(base + "/api/system/ready", timeout=5) as response:
            value = json.load(response)
        return {"http": response.status, "code": value.get("code"), "data": value.get("data")}

    def verify_snapshot(self, value, baseline):
        state = value.get("state", value)
        identities = lambda snapshot: [(item["key"], item.get("file")) for item in snapshot["items"]]
        if state["journal"] or any(row["status"] in ("pending", "running") for row in state["requests"]):
            raise AcceptanceViolation("Observation has an unconfirmed write or active request")
        if (identities(value) != identities(baseline) or value["files"] != baseline["files"]
                or len(state["tasks"]) != len(baseline["tasks"])):
            raise AcceptanceViolation("Observation changed baseline media, membership or file tasks")

    def observe(self):
        duration, idle_seconds, expected_workloads = observation_plan(self.cfg)
        started = time.time()
        monotonic_start = time.monotonic()
        private = self.inspect()
        production = self.inspect(self.cfg["productionContainer"])
        previous = self.helper("snapshot")
        if previous["journal"] or any(row["status"] in ("pending", "running") for row in previous["requests"]):
            raise RuntimeError("Observation requires an idle, confirmed baseline")
        write(self.root / "observation-baseline.json", previous)
        write(self.control / "observation-baseline.json", previous)
        self.status(status="observing", pid=os.getpid(), startedAt=now(),
                    expectedEndAt=dt.datetime.fromtimestamp(started + duration, dt.timezone.utc).isoformat(),
                    privateBaseline=private, productionBaseline=production, samples=0, workloadRuns=0, issues=[],
                    error=None, failedStage=None, stage="observation", expectedWorkloadRuns=expected_workloads,
                    observationMode=self.cfg.get("observationMode", "full"))
        samples, workloads, issues, rss = 0, 0, [], []
        next_workload_at, workload_attempts, workload_paused = idle_seconds, 0, False
        probe_errors = {}
        while time.monotonic() - monotonic_start < duration:
            cycle = time.monotonic()
            elapsed = cycle - monotonic_start
            phase = "idle" if elapsed < idle_seconds else "periodic_sync"
            row = {"at": now(), "elapsedSeconds": int(elapsed), "phase": phase}
            stage, mutation_attempted = "continuity", False
            try:
                own = self.inspect()
                prod = self.inspect(self.cfg["productionContainer"])
                row.update(privateContainer=own, productionContainer=prod)
                for label, observed, baseline in (("private", own, private), ("production", prod, production)):
                    if observed["status"] != "running" or observed["oom"] or any(observed[key] != baseline[key] for key in ("image", "id", "startedAt", "restartCount")):
                        raise AcceptanceViolation(label + " container continuity changed")
                stage = "runtime_probe"
                row["runtime"] = self.helper("sample")
                runtime = row["runtime"]
                if runtime["sseClients"] != 0 or runtime["queue"]["total"] != len(previous["tasks"]):
                    raise AcceptanceViolation("SSE client did not close or repeat sync created extra file tasks")
                if any(runtime["queue"][key] for key in ("pending", "downloading", "tagging")) or runtime["scheduler"]["runningCount"]:
                    raise AcceptanceViolation("Observation workload did not drain")
                rss.append(row["runtime"]["memory"]["rss"])
                if len(rss) >= 5 and all(value > 768 * 1024 * 1024 for value in rss[-5:]):
                    raise AcceptanceViolation("Private RSS exceeded 768 MiB for five consecutive samples")
                if not workload_paused and elapsed >= next_workload_at:
                    # A read failure skips this cycle. Never retry a failed mutation blindly.
                    stage = "workload_snapshot"
                    self.verify_snapshot(self.helper("snapshot"), previous)
                    stage, mutation_attempted = "workload", True
                    workload_attempts += 1
                    result = self.helper("sync")
                    self.verify_snapshot(result, previous)
                    workloads += 1
                    next_workload_at = elapsed + 1800
                    row["workload"] = {"runStatus": result["request"]["run_status"], "members": len(result["items"])}
                stage, mutation_attempted = "private_stats", False
                row["privateStats"] = self.stats(self.name)
                stage = "production_stats"
                row["productionStats"] = self.stats(self.cfg["productionContainer"])
                stage = "production_ready"
                row["productionReady"] = self.health(self.cfg["productionUrl"])
                if row["productionReady"].get("code") != 0 or not row["productionReady"].get("data", {}).get("ready"):
                    raise RuntimeError("Production readiness probe was not ready")
            except Exception as error:
                fatal = isinstance(error, AcceptanceViolation) or mutation_attempted
                row.update(errorStage=stage, workloadWriteStopped=fatal)
                if fatal:
                    workload_paused = True
                    message = str(error) if isinstance(error, AcceptanceViolation) else "Workload execution failed; result requires review"
                    row["error"] = message
                    if message not in issues:
                        issues.append(message)
                else:
                    category = "timeout" if "timed out" in str(error).lower() or isinstance(error, TimeoutError) else "probe_failed"
                    row["probeError"] = {"stage": stage, "category": category}
                    probe_errors[stage] = probe_errors.get(stage, 0) + 1
            with open(str(self.root / "samples.jsonl"), "a") as stream:
                stream.write(json.dumps(row, ensure_ascii=False) + "\n")
            samples += 1
            warm = rss[30:150] if len(rss) > 150 else rss
            tail = rss[-120:]
            growth = statistics.median(tail) - statistics.median(warm) if warm and tail else 0
            self.status(phase=phase, samples=samples, workloadRuns=workloads, issues=issues,
                        lastHeartbeatAt=now(), lastSample=row, rssMedianGrowthBytes=growth,
                        workloadAttempts=workload_attempts, workloadPaused=workload_paused,
                        probeErrorCounts=probe_errors)
            time.sleep(max(0, min(60 - (time.monotonic() - cycle), duration - (time.monotonic() - monotonic_start))))
        complete = workloads >= expected_workloads
        if not complete:
            issues.append("Scheduled workload coverage incomplete")
        self.status(status="observation_complete_pending_review", finishedAt=now(), issues=issues, coverageComplete=complete)
        self.record("observation_window_finished", passed=None, samples=samples, workloadRuns=workloads,
                    expectedWorkloadRuns=expected_workloads, coverageComplete=complete, issues=issues,
                    probeErrorCounts=probe_errors)
        self.cleanup()

    def cleanup(self):
        self.guard()
        if self.inspect()["status"] != "running":
            self.docker("start", self.name)
            self.wait_ready()
        removed = self.helper("cleanup")
        self.stop()
        self.docker("rm", self.name)
        proof = load(self.root / "seed-proof.json")
        unchanged = digest(proof["source"]) == proof["sha256"]
        if not unchanged:
            raise RuntimeError("Original seed hash changed; retain test files for investigation")
        for path in (self.data, self.control, self.root / "bootstrap", self.root / "backups", self.root / "tampered-backup"):
            if path.exists():
                shutil.rmtree(str(path))
        for path in self.root.glob("data.before-restore-*"):
            shutil.rmtree(str(path))
        shutil.rmtree(str(self.media))
        self.status(cleanupComplete=True, credentialsRemoved=True, originalSeedUnchanged=unchanged)
        self.record("scoped_cleanup", passed=True, **removed, originalSeedUnchanged=unchanged)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "writes", "download", "backup", "observe", "launch", "status", "cleanup"])
    parser.add_argument("--root", required=True)
    args = parser.parse_args()
    run = Acceptance(args.root)
    if args.action == "status":
        value = load(run.root / "status.json")
        pid = value.get("pid")
        cmdline = Path("/proc/%s/cmdline" % pid) if pid else None
        value["collectorAlive"] = bool(cmdline and cmdline.exists() and str(run.root).encode() in cmdline.read_bytes())
        print(json.dumps(value, ensure_ascii=False, indent=2))
        return
    if args.action == "launch":
        state = load(run.root / "status.json")
        if state.get("status") == "observing":
            raise RuntimeError("Observation already launched")
        log = open(str(run.root / "collector.log"), "a")
        proc = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "observe", "--root", str(run.root)],
                                stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
        print(json.dumps({"collectorPid": proc.pid, "root": str(run.root)}))
        return
    try:
        if args.action == "prepare":
            run.bootstrap()
        elif args.action == "writes":
            run.uncertain_write("hold_insert_response")
            run.uncertain_write("hold_insert_before")
        elif args.action == "download":
            run.download_interrupt()
        elif args.action == "backup":
            run.backup_restore()
        elif args.action == "observe":
            run.observe()
        elif args.action == "cleanup":
            run.cleanup()
    except Exception as error:
        run.record(args.action, passed=False, error=str(error))
        run.status(status="needs_attention", failedStage=args.action, error=str(error))
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
