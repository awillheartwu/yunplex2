#!/bin/sh
set -eu
umask 022
node /acceptance/nas-plex-proxy.mjs &
proxy_pid=$!
node /app/.output/server/index.mjs &
app_pid=$!
shutdown() {
  kill -TERM "$app_pid" 2>/dev/null || true
  wait "$app_pid" || true
  kill -TERM "$proxy_pid" 2>/dev/null || true
}
trap shutdown TERM INT
set +e
wait "$app_pid"
code=$?
kill -TERM "$proxy_pid" 2>/dev/null || true
wait "$proxy_pid" 2>/dev/null
exit "$code"
