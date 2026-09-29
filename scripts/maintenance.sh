#!/bin/sh
# Run from the Compose project directory. No daemon or scheduler starts here.
set -eu
umask 077
command=${1:-}
location=${2:-}
case "$command" in backup|restore|verify) ;; *) echo 'Usage: sh scripts/maintenance.sh backup OUTPUT_DIR | verify BUNDLE_DIR | restore BUNDLE_DIR' >&2; exit 1 ;; esac
[ -n "$location" ] || { echo 'An explicit backup location is required' >&2; exit 1; }
container=$(docker compose ps -a -q yunplex2)
[ -n "$container" ] || { echo 'Create the application container first with docker compose create yunplex2' >&2; exit 1; }
[ "$(docker inspect -f '{{.State.Running}}' "$container")" = false ] || { echo 'Stop yunplex2 before maintenance' >&2; exit 1; }
source=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{if eq .Type "bind"}}{{.Source}}{{end}}{{end}}{{end}}' "$container")
[ -n "$source" ] || { echo 'Maintenance requires a bind mount at /app/data' >&2; exit 1; }
# Refuse another running container using this application directory.
for running in $(docker ps -q); do
  if docker inspect -f '{{range .Mounts}}{{println .Source}}{{end}}' "$running" | grep -Fx "$source" >/dev/null; then
    echo 'Another running container is using the application data' >&2; exit 1
  fi
done
image=$(docker inspect -f '{{.Image}}' "$container")
parent=$(dirname "$source")
name=$(basename "$source")
[ "$parent" != / ] || { echo 'Use a dedicated data parent directory' >&2; exit 1; }
if [ "$command" = backup ]; then mkdir -p "$location"; fi
location=$(cd "$location" && pwd -P)
case "$location/" in "$source/"*) echo 'Store backups outside application data' >&2; exit 1 ;; esac
mode=ro
[ "$command" = backup ] && mode=rw
# Mount the parent so restore can rename directories atomically. Restrict this
# mount to a dedicated application directory; music is never mounted here.
docker run --rm --network none --entrypoint node \
  -v "$parent:/maintenance-data" -v "$location:/backups:$mode" \
  "$image" /app/maintenance/cli.mjs "$command" "/maintenance-data/$name" /backups
