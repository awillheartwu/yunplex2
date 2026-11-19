"""Collector regression checks. Fake time and services; no Docker or network."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

source = Path(__file__).resolve().parents[2] / "acceptance" / "nas-release.py"
spec = importlib.util.spec_from_file_location("nas_release_acceptance", source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Clock:
    def __init__(self):
        self.elapsed = 0

    def monotonic(self):
        return self.elapsed

    def timestamp(self):
        return 1793376000 + self.elapsed

    def sleep(self, seconds):
        self.elapsed += max(0.001, seconds)


class FakeAcceptance(module.Acceptance):
    def __init__(self, root, clock):
        super().__init__(root)
        self.clock = clock
        self.health_errors = 0
        self.runtime_error_until = 0
        self.unsafe_queue = False
        self.changed_files = False
        self.fail_mutation = False
        self.restart_at = None
        self.mutation_times = []
        self.events = []
        self.cleaned = False
        self.baseline = {"journal": None, "requests": [], "tasks": [{"id": "file-1"}],
                         "items": [{"key": "1", "file": "/fixture/one.flac"},
                                   {"key": "2", "file": "/fixture/two.flac"}],
                         "files": [{"path": "one.flac", "sha256": "synthetic"}]}

    def inspect(self, name=None):
        return {"id": name or self.name, "image": "fixture-image", "status": "running",
                "startedAt": "changed-boot" if self.restart_at is not None and self.clock.elapsed >= self.restart_at else "fixture-boot",
                "restartCount": 0, "oom": False}

    def helper(self, command, *args, **kwargs):
        if command == "snapshot":
            value = copy.deepcopy(self.baseline)
            if self.changed_files and self.clock.elapsed > 0:
                value["files"][0]["sha256"] = "changed"
            return value
        if command == "sample":
            if self.clock.elapsed < self.runtime_error_until:
                raise TimeoutError("Synthetic read probe timed out")
            return {"sseClients": 0, "queue": {"total": 2 if self.unsafe_queue else 1,
                    "pending": 0, "downloading": 0, "tagging": 0},
                    "scheduler": {"runningCount": 0}, "memory": {"rss": 100 * 1048576}}
        if command == "sync":
            self.mutation_times.append(self.clock.elapsed)
            if self.fail_mutation:
                raise TimeoutError("Synthetic write response timed out")
            result = copy.deepcopy(self.baseline)
            return {"request": {"run_status": "success"}, "state": result,
                    "items": result["items"], "files": result["files"]}
        raise AssertionError("Unexpected helper command")

    def stats(self, name):
        return {"MemUsage": "100MiB / 1GiB"}

    def health(self, base):
        if self.health_errors:
            self.health_errors -= 1
            raise TimeoutError("Synthetic production probe timed out")
        return {"http": 200, "code": 0, "data": {"ready": True}}

    def record(self, case, **details):
        self.events.append({"case": case, **details})

    def cleanup(self):
        self.cleaned = True


class ObservationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="yunplex-observation-unit-")
        self.addCleanup(self.directory.cleanup)
        parent = Path(self.directory.name)
        self.root = parent / "yunplex-acceptance-fixture"
        self.root.mkdir()
        (self.root / "control").mkdir()
        (self.root / "scope.json").write_text(json.dumps({"scope": self.root.name}))
        self.config = {"scope": self.root.name, "mediaRoot": str(parent / "media" / self.root.name),
                       "productionContainer": "production-fixture", "productionUrl": "http://fixture.invalid",
                       "image": "sha256:" + "a" * 64, "revision": "b" * 40,
                       "observationMode": "periodic_sync", "durationSeconds": 43200}
        self.clock = Clock()

    def create(self):
        (self.root / "run.json").write_text(json.dumps(self.config))
        return FakeAcceptance(self.root, self.clock)

    def observe(self, run):
        with patch.object(module.time, "monotonic", self.clock.monotonic), \
             patch.object(module.time, "time", self.clock.timestamp), \
             patch.object(module.time, "sleep", self.clock.sleep):
            run.observe()
        return module.load(self.root / "status.json")

    def test_idle_production_timeout_does_not_cancel_later_workloads(self):
        self.config.update(observationMode="full", durationSeconds=86400)
        run = self.create()
        run.health_errors = 1
        state = self.observe(run)
        self.assertEqual(len(run.mutation_times), 24)
        self.assertGreaterEqual(run.mutation_times[0], 43200)
        self.assertFalse(state["workloadPaused"])
        self.assertTrue(state["coverageComplete"])
        self.assertEqual(state["probeErrorCounts"], {"production_ready": 1})

    def test_private_probe_timeout_skips_a_cycle_and_recovers(self):
        run = self.create()
        run.runtime_error_until = 60
        state = self.observe(run)
        self.assertEqual(len(run.mutation_times), 24)
        self.assertGreaterEqual(run.mutation_times[0], 60)
        self.assertFalse(state["workloadPaused"])
        self.assertEqual(state["probeErrorCounts"], {"runtime_probe": 1})

    def test_extra_file_task_permanently_stops_writes(self):
        run = self.create()
        run.unsafe_queue = True
        state = self.observe(run)
        self.assertEqual(run.mutation_times, [])
        self.assertTrue(state["workloadPaused"])
        self.assertFalse(state["coverageComplete"])

    def test_unknown_write_response_is_never_retried(self):
        run = self.create()
        run.fail_mutation = True
        state = self.observe(run)
        self.assertEqual(len(run.mutation_times), 1)
        self.assertEqual(state["workloadAttempts"], 1)
        self.assertEqual(state["workloadRuns"], 0)
        self.assertTrue(state["workloadPaused"])

    def test_changed_media_is_detected_before_the_next_write(self):
        run = self.create()
        run.changed_files = True
        state = self.observe(run)
        self.assertEqual(len(run.mutation_times), 1)
        self.assertTrue(state["workloadPaused"])
        self.assertFalse(state["coverageComplete"])

    def test_missing_workload_coverage_is_not_silently_accepted(self):
        run = self.create()
        run.runtime_error_until = 43200
        state = self.observe(run)
        self.assertFalse(state["coverageComplete"])
        self.assertIn("Scheduled workload coverage incomplete", state["issues"])
        self.assertEqual(state["expectedWorkloadRuns"], 24)
        self.assertTrue(run.cleaned)

    def test_container_restart_stops_further_writes(self):
        run = self.create()
        run.restart_at = 60
        state = self.observe(run)
        self.assertEqual(len(run.mutation_times), 1)
        self.assertTrue(state["workloadPaused"])
        self.assertFalse(state["coverageComplete"])

    def test_modes_enforce_their_observation_window(self):
        self.assertEqual(module.observation_plan(self.config), (43200, 0, 24))
        with self.assertRaises(RuntimeError):
            module.observation_plan({"observationMode": "full", "durationSeconds": 43200})

    def candidate_metadata(self):
        return {"Id": self.config["image"], "Os": "linux", "Architecture": "amd64",
                "Config": {"Labels": {"org.opencontainers.image.revision": self.config["revision"]}}}

    def test_candidate_does_not_need_to_be_deployed_to_production_first(self):
        run = self.create()
        self.assertNotEqual(run.inspect(self.config["productionContainer"])["image"], self.config["image"])
        with patch.object(run, "docker", return_value=SimpleNamespace(stdout=json.dumps([self.candidate_metadata()]))):
            run.validate_candidate_image()

    def test_wrong_candidate_revision_is_rejected_before_copying_credentials(self):
        run = self.create()
        metadata = self.candidate_metadata()
        metadata["Config"]["Labels"]["org.opencontainers.image.revision"] = "c" * 40
        with patch.object(run, "docker", return_value=SimpleNamespace(stdout=json.dumps([metadata]))):
            with self.assertRaisesRegex(RuntimeError, "revision does not match"):
                run.bootstrap()
        self.assertFalse(run.data.exists())
        self.assertFalse((self.root / "bootstrap").exists())

    def test_candidate_requires_the_nas_platform(self):
        run = self.create()
        for key, value in (("Os", "windows"), ("Architecture", "arm64")):
            with self.subTest(key=key):
                metadata = self.candidate_metadata()
                metadata[key] = value
                with patch.object(run, "docker", return_value=SimpleNamespace(stdout=json.dumps([metadata]))):
                    with self.assertRaisesRegex(RuntimeError, "platform"):
                        run.validate_candidate_image()

    def test_mutable_candidate_reference_is_rejected_without_docker_operations(self):
        self.config["image"] = "fixture:latest"
        run = self.create()
        with patch.object(run, "docker") as docker:
            with self.assertRaisesRegex(RuntimeError, "immutable image ID"):
                run.validate_candidate_image()
            docker.assert_not_called()

    def test_wrong_running_image_stops_before_service_writes(self):
        run = self.create()
        container = {"scope": run.scope, "image": "sha256:" + "c" * 64}
        with patch.object(run, "docker", return_value=SimpleNamespace(stdout=json.dumps(container))) as docker:
            with self.assertRaisesRegex(RuntimeError, "not running the validated candidate"):
                module.Acceptance.helper(run, "setup")
            self.assertEqual(len(docker.call_args_list), 1)
            self.assertEqual(docker.call_args[0][0], "inspect")


if __name__ == "__main__":
    unittest.main()
