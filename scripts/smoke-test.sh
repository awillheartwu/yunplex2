#!/bin/bash
# Smoke test: verify full compare / reorder decision paths
set -e

API="http://localhost:3001/api"
SOURCE_ID="62c3abce-ffe1-48cd-b01e-fba1b6b546f1"
PASS=0; FAIL=0

log()  { echo -e "\n━━━ $1 ━━━"; }
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
err()  { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

wait_sync() {
  local timeout=300 start=$(date +%s)
  while true; do
    local running=$(curl -s --max-time 3 "$API/sync/status" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['isRunning'])" 2>/dev/null || echo "True")
    [ "$running" = "False" ] && break
    [ $(($(date +%s) - start)) -gt $timeout ] && { echo "  ⚠ timeout"; return 1; }
    sleep 2
  done
  sleep 2  # Allow log flush
}

# Search logs by keyword substring
grep_log() {
  curl -s --max-time 3 "$API/logs?limit=30" | python3 -c "
import json,sys
for item in json.load(sys.stdin)['data']['items']:
    if '$1' in item.get('message',''):
        print(item['message'])
        break
" 2>/dev/null
}

trigger_sync() {
  curl -s --max-time 5 -X POST "$API/playlist-sources/$SOURCE_ID/sync" > /dev/null
}

get_field() {
  curl -s --max-time 3 "$API/playlist-sources/$SOURCE_ID" | python3 -c "import json,sys; print(json.load(sys.stdin)['data'].get('$1',''))" 2>/dev/null
}

# ── Pre-flight: hydrate snapshot ──
log "Pre-flight: ensure snapshot exists"
SNAPSHOT=$(get_field "trackIdSnapshot")
if [ "$SNAPSHOT" = "None" ] || [ "$SNAPSHOT" = "" ]; then
  echo "  Running full sync to hydrate..."
  curl -s --max-time 5 -X POST "$API/playlist-sources/$SOURCE_ID/sync" \
    -H 'Content-Type: application/json' -d '{"forceFull":true}' > /dev/null
  wait_sync
  SNAPSHOT=$(get_field "trackIdSnapshot")
  echo "  snapshot now: $(echo "$SNAPSHOT" | head -c 50)..."
else
  echo "  already hydrated"
fi

# ── Save original snapshot ──
ORIG_SNAPSHOT="$SNAPSHOT"

# ── Test 1: forceFull triggers full compare ──
log "Test 1: forceFull → FULL compare"
SKIPS_BEFORE=$(get_field "consecutiveSkips")
curl -s --max-time 5 -X POST "$API/playlist-sources/$SOURCE_ID/sync" \
  -H 'Content-Type: application/json' -d '{"forceFull":true}' > /dev/null
wait_sync
MSG1=$(grep_log "连接 Plex")
MSG2=$(grep_log "歌单获取完成")
echo "  log: $MSG2 | $MSG1"
SKIPS_AFTER=$(get_field "consecutiveSkips")
[ -n "$MSG1" ] && ok "Full compare triggered (forceFull)" || err "Full compare not detected"

# ── Test 2: PURE REORDER (swap first two snapshot IDs) ──
log "Test 2: Pure reorder shortcut"
if [ "$ORIG_SNAPSHOT" != "None" ] && [ ${#ORIG_SNAPSHOT} -gt 10 ]; then
  REORDERED=$(echo "$ORIG_SNAPSHOT" | python3 -c "
import json,sys
ids=json.load(sys.stdin)
if len(ids)>=2: ids[0],ids[1]=ids[1],ids[0]
print(json.dumps(ids))
")
  # Inject reordered snapshot via DB
  ESCAPED=$(echo "$REORDERED" | sed "s/'/''/g")
  sqlite3 /Users/wuhaoli/projects/reyunplex/reYunPlex/data/data.db \
    "UPDATE playlist_sources SET track_id_snapshot='$ESCAPED' WHERE id='$SOURCE_ID';"

  trigger_sync
  wait_sync
  MSG=$(grep_log "仅顺序变化")
  echo "  log: $MSG"

  # Restore
  ORIG_ESC=$(echo "$ORIG_SNAPSHOT" | sed "s/'/''/g")
  sqlite3 /Users/wuhaoli/projects/reyunplex/reYunPlex/data/data.db \
    "UPDATE playlist_sources SET track_id_snapshot='$ORIG_ESC' WHERE id='$SOURCE_ID';"

  [ -n "$MSG" ] && ok "Pure reorder shortcut triggered ✓" || err "Pure reorder NOT triggered"
else
  echo "  ⚠ No snapshot, skipping"
fi

# ── Results ──
echo ""
echo "══════════════════════════════"
echo "  Passed: $PASS  Failed: $FAIL"
echo "══════════════════════════════"
