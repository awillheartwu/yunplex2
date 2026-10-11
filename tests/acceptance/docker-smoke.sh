#!/bin/sh
# Bounded Docker smoke test for an already available application image.
#
# Usage: sh tests/acceptance/docker-smoke.sh IMAGE
#
# Boots IMAGE on the local Docker daemon with fresh temporary volumes, no
# network and no published ports, then verifies /api/system/ready (the image
# serves the app on port 3000), the SPA shell, the SQLite file, a restart and a
# graceful stop. Only the container and volumes created by this run are
# removed; the image, the daemon and the host stay untouched.
#
# The isolated default is the image user node (uid 1000). Set NASUID=uid[:gid]
# to run as a specific host user instead; only this run's temporary data
# volume is re-owned for that uid.
#
# SMOKE_READY_TIMEOUT overrides the 120s readiness budget, in seconds.
set -eu
umask 077

image=${1:-}
if [ -z "$image" ]; then
  echo 'Usage: sh tests/acceptance/docker-smoke.sh IMAGE' >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo 'docker CLI not found; run this smoke test on a Docker host' >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo 'Docker daemon unavailable; not running the smoke test' >&2
  exit 1
fi
if ! docker image inspect "$image" >/dev/null 2>&1; then
  echo "Image $image not found on the local Docker daemon" >&2
  exit 1
fi

stamp=$(date +%Y%m%d%H%M%S)-$$
label_key=com.yunplex2.smoke
container_name="yunplex2-smoke-$stamp"
data_volume=''
music_volume=''
ready_timeout=${SMOKE_READY_TIMEOUT:-120}
container_id=''
nas_uid=${NASUID:-}
case "$ready_timeout" in ''|*[!0-9]*|0) echo 'Invalid SMOKE_READY_TIMEOUT' >&2; exit 1 ;; esac
if [ -n "$nas_uid" ] && ! printf '%s' "$nas_uid" | grep -Eq '^[1-9][0-9]*(:[1-9][0-9]*)?$'; then
  echo 'NASUID must be a numeric non-root uid[:gid]' >&2; exit 1
fi

show_logs() {
  [ -n "$container_id" ] || return 0
  docker logs "$container_id" 2>&1 | tail -n 40 >&2 || true
}

# Idempotent teardown: exact ids/names only, safe to run more than once.
cleanup() {
  status=$?
  trap - EXIT
  if [ -n "$container_id" ]; then
    docker stop -t 15 "$container_id" >/dev/null 2>&1 || true
    docker rm -f "$container_id" >/dev/null 2>&1 || true
  fi
  [ -z "$data_volume" ] || docker volume rm "$data_volume" >/dev/null 2>&1 || true
  [ -z "$music_volume" ] || docker volume rm "$music_volume" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

fail() {
  echo "$1" >&2
  show_logs
  exit 1
}

# Runs a Node expression inside the container; stdout only, failures as ''.
container_node() {
  docker exec "$container_id" node -e "$1" 2>/dev/null || true
}

wait_ready() {
  deadline=$(( $(date +%s) + ready_timeout ))
  while :; do
    if [ "$(docker inspect -f '{{.State.Running}}' "$container_id")" != true ]; then
      fail 'Container exited before becoming ready'
    fi
    state=$(container_node 'fetch("http://127.0.0.1:3000/api/system/ready",{signal:AbortSignal.timeout(3000)}).then(async (response) => { const body = await response.json().catch(() => null); const data = (body && body.data) || {}; process.stdout.write("code:" + (body ? body.code : "none") + " ready:" + data.ready + " status:" + data.status); }).catch(() => process.stdout.write("unreachable"))')
    case "$state" in
      *'code:0 ready:true status:setup_required'*) return 0 ;;
    esac
    if [ "$(date +%s)" -ge "$deadline" ]; then
      fail "Readiness not reached within ${ready_timeout}s (last probe: $state)"
    fi
    sleep 1
  done
}

check_data_file() {
  docker exec "$container_id" sh -c 'test -f /app/data/data.db' 2>/dev/null || fail "data.db missing under /app/data $1"
}

echo '==> Creating temporary volumes'
# Let Docker assign names: concurrent jobs can share a PID namespace value and
# timestamp, but cannot accidentally reuse or clean each other's volumes.
data_volume=$(docker volume create --label "$label_key.run=$stamp" --label "$label_key.role=data")
music_volume=$(docker volume create --label "$label_key.run=$stamp" --label "$label_key.role=music")
container_name="yunplex2-smoke-$(printf '%s' "$data_volume" | cut -c1-24)"

# Re-own only this run's temporary volumes, including the writable music dir.
volume_owner=${nas_uid:-1000:1000}
docker run --rm --network none --user 0:0 --entrypoint sh \
  --volume "$data_volume:/app/data:nocopy" --volume "$music_volume:/mnt/nas:nocopy" \
  "$image" -c "chown -R $volume_owner /app/data /mnt/nas" >/dev/null

echo "==> Starting container $container_name"
set -- docker run --detach --name "$container_name" \
  --label "$label_key.run=$stamp" \
  --network none \
  --memory 1g --memory-swap 1g --cpus 2 --pids-limit 256 \
  --init --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --tmpfs /tmp:rw,nosuid,nodev,size=128m,mode=1777 \
  --env YUNPLEX2_SYNC_ENABLED=false \
  --volume "$data_volume:/app/data:nocopy" \
  --volume "$music_volume:/mnt/nas:nocopy"
[ -z "$nas_uid" ] || set -- "$@" --user "$nas_uid"
set -- "$@" "$image"
container_id=$("$@")

echo '==> Waiting for readiness (ready=true, status=setup_required)'
wait_ready

uid=$(container_node 'process.stdout.write(String(process.getuid()))')
expected_uid=${nas_uid%%:*}
expected_uid=${expected_uid:-1000}
[ "$uid" = "$expected_uid" ] || fail "Container runs as uid $uid, expected $expected_uid"

echo '==> Checking the SPA shell'
spa=$(container_node 'fetch("http://127.0.0.1:3000/",{signal:AbortSignal.timeout(3000)}).then(async (response) => { const text = await response.text(); const type = response.headers.get("content-type") || ""; process.stdout.write("status:" + response.status + " html:" + type.includes("text/html") + " mount:" + text.includes("__nuxt") + " bytes:" + text.length); }).catch(() => process.stdout.write("unreachable"))')
case "$spa" in
  *'status:200 html:true mount:true'*) echo "    $spa" ;;
  *) fail "SPA shell check failed: $spa" ;;
esac

echo '==> Checking the SQLite file'
check_data_file 'after first boot'
echo '==> Runtime resources after readiness'
docker stats --no-stream --format 'Memory: {{.MemUsage}}; CPU: {{.CPUPerc}}' "$container_id"

echo '==> Restarting and rechecking'
docker restart -t 45 "$container_id" >/dev/null
wait_ready
check_data_file 'after restart'
uid=$(container_node 'process.stdout.write(String(process.getuid()))')
[ "$uid" = "$expected_uid" ] || fail "Container runs as uid $uid after restart, expected $expected_uid"

echo '==> Stopping the container'
docker stop -t 45 "$container_id" >/dev/null || true
exit_code=$(docker inspect -f '{{.State.ExitCode}}' "$container_id")
[ "$exit_code" = 0 ] || fail "Container exited with code $exit_code after stop (expected 0)"
if docker logs "$container_id" 2>&1 | grep -q 'A consumer failed to stop cleanly'; then
  fail 'A background consumer did not stop cleanly during shutdown'
fi

echo "docker smoke OK: $image"
