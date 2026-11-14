#!/usr/bin/env bash
# Lifecycle helper for the verify-racing-game skill. See ../SKILL.md.
#   verify.sh smoke | all [journeys] | up | doctor | run <journey> [args] | bot [flags] | sql "<query>" | down | env
# VERIFY_SLOT=<0-9> selects an isolated instance (own ports, own database).
set -euo pipefail

SKILL_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
REPO=$(git -C "$SKILL_DIR" rev-parse --show-toplevel)
SLOT=${VERIFY_SLOT:-0}
[[ $SLOT =~ ^[0-9]$ ]] || { echo "verify: VERIFY_SLOT must be 0-9, got '$SLOT'" >&2; exit 2; }

SERVER_PORT=$((8190 + SLOT * 10))
CLIENT_PORT=$((5190 + SLOT * 10)) # real player build
SEAM_PORT=$((5191 + SLOT * 10))   # VITE_E2E build: window.__game seam, cheap render
WT_HASH=$(printf '%s' "$REPO" | shasum | cut -c1-6)
DB_NAME="racing_verify_${WT_HASH}_s${SLOT}"
RUN_DIR="$REPO/reports/verify/.run/slot$SLOT"
EVIDENCE_ROOT="$REPO/reports/verify"

# Admin connection: VERIFY_PG_URL, else DATABASE_URL from the shell or the repo .env, else
# the compose default. Only its host/credentials are used; the database is always DB_NAME.
admin_url() {
  if [[ -n ${VERIFY_PG_URL:-} ]]; then echo "$VERIFY_PG_URL"; return; fi
  local url=${DATABASE_URL:-}
  if [[ -z $url && -f "$REPO/.env" ]]; then
    url=$(sed -n 's/^DATABASE_URL=//p' "$REPO/.env" | tail -1)
  fi
  echo "${url:-postgres://postgres:postgres@localhost:5432/racing}"
}
ADMIN_URL=$(admin_url)
# up/down CREATE and DROP databases there: only on a local server unless named explicitly.
ADMIN_HOST=$(node -e 'console.log(new URL(process.argv[1]).hostname)' "$ADMIN_URL")
if [[ -z ${VERIFY_PG_URL:-} && ! $ADMIN_HOST =~ ^(localhost|127\.0\.0\.1|::1|\[::1\])$ ]]; then
  echo "verify: DATABASE_URL points at $ADMIN_HOST, not a local Postgres; set VERIFY_PG_URL to a disposable server" >&2
  exit 1
fi
DB_URL=$(node -e 'const u=new URL(process.argv[1]);u.pathname="/"+process.argv[2];console.log(u.toString())' "$ADMIN_URL" "$DB_NAME")

export VERIFY_SLOT=$SLOT VERIFY_SERVER_PORT=$SERVER_PORT VERIFY_CLIENT_PORT=$CLIENT_PORT \
  VERIFY_SEAM_PORT=$SEAM_PORT VERIFY_DB_URL=$DB_URL VERIFY_EVIDENCE_ROOT=$EVIDENCE_ROOT \
  VERIFY_REPO=$REPO

pg() { node "$SKILL_DIR/scripts/pg.mjs" "$@"; }

port_busy() { nc -z 127.0.0.1 "$1" >/dev/null 2>&1; }

alive() { [[ -f "$RUN_DIR/$1.pid" ]] && kill -0 "$(cat "$RUN_DIR/$1.pid")" 2>/dev/null; }

# Start a command in its own process group (job control), so down can kill the whole tree.
start() {
  local name=$1; shift
  set -m
  (cd "$REPO" && exec env "$@") >"$RUN_DIR/$name.log" 2>&1 &
  echo $! >"$RUN_DIR/$name.pid"
  disown
  set +m
}

wait_for() { # name url timeout-seconds
  local name=$1 url=$2 deadline=$((SECONDS + $3))
  until curl -fsS -o /dev/null "$url" 2>/dev/null; do
    if ! alive "$name"; then
      echo "verify: $name exited during startup; last log lines ($RUN_DIR/$name.log):" >&2
      tail -20 "$RUN_DIR/$name.log" >&2; return 1
    fi
    if ((SECONDS > deadline)); then echo "verify: $name not ready at $url after $3s" >&2; return 1; fi
    sleep 0.5
  done
}

cmd_up() {
  for name in server client seam; do
    if alive "$name"; then echo "verify: slot $SLOT is already up (run doctor, or down first)" >&2; exit 1; fi
  done
  for port in $SERVER_PORT $CLIENT_PORT $SEAM_PORT; do
    if port_busy "$port"; then
      echo "verify: port $port is held by a process this slot did not start; pick another VERIFY_SLOT" >&2
      exit 1
    fi
  done
  mkdir -p "$RUN_DIR"
  [[ -d "$REPO/node_modules" ]] || { echo "verify: run 'npm ci' first" >&2; exit 1; }

  # Every up starts from an empty database; the server creates the schema on boot.
  pg admin "$ADMIN_URL" "DROP DATABASE IF EXISTS $DB_NAME WITH (FORCE)"
  pg admin "$ADMIN_URL" "CREATE DATABASE $DB_NAME"

  start server DATABASE_URL="$DB_URL" PORT="$SERVER_PORT" npm run start -w @racing/server
  start client VITE_SERVER_PORT="$SERVER_PORT" npm run dev -w @racing/client -- \
    --port "$CLIENT_PORT" --strictPort --host 127.0.0.1
  start seam VITE_SERVER_PORT="$SERVER_PORT" npm run dev:e2e -w @racing/client -- \
    --port "$SEAM_PORT" --strictPort --host 127.0.0.1
  git -C "$REPO" rev-parse --short HEAD >"$RUN_DIR/rev"
  date +%s >"$RUN_DIR/started"

  # /healthz only answers after the schema exists and the server listens.
  wait_for server "http://127.0.0.1:$SERVER_PORT/healthz" 60 || { cmd_down; exit 1; }
  wait_for client "http://127.0.0.1:$CLIENT_PORT/" 60 || { cmd_down; exit 1; }
  wait_for seam "http://127.0.0.1:$SEAM_PORT/" 60 || { cmd_down; exit 1; }
  echo "verify: ready slot $SLOT — client http://127.0.0.1:$CLIENT_PORT seam http://127.0.0.1:$SEAM_PORT server ws://127.0.0.1:$SERVER_PORT db $DB_NAME"
}

cmd_doctor() {
  local ok=1
  check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; ok=0; fi; }
  echo "slot $SLOT: server $SERVER_PORT, client $CLIENT_PORT, seam $SEAM_PORT, db $DB_NAME"
  for name in server client seam; do check "$name process alive (pidfile)" "alive $name"; done
  check "server /healthz answers ok" \
    "[[ \$(curl -fsS http://127.0.0.1:$SERVER_PORT/healthz 2>/dev/null) == ok ]]"
  check "client serves Sunset Ridge Racing" \
    "curl -fsS http://127.0.0.1:$CLIENT_PORT/ 2>/dev/null | grep -q '<title>Sunset Ridge Racing</title>'"
  check "seam client serves Sunset Ridge Racing" \
    "curl -fsS http://127.0.0.1:$SEAM_PORT/ 2>/dev/null | grep -q '<title>Sunset Ridge Racing</title>'"
  check "database $DB_NAME has the schema" \
    "pg query \"SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name IN ('rooms','best_laps','replays','daily_laps')\" 2>/dev/null | grep -q '\"n\": 4'"
  if [[ -f "$RUN_DIR/started" ]]; then
    local stale
    stale=$(find "$REPO/server/src" "$REPO/shared/src" -newer "$RUN_DIR/started" -type f 2>/dev/null | head -5)
    check "server code unchanged since up (rev $(cat "$RUN_DIR/rev"); server has no hot reload)" "[[ -z '$stale' ]]"
    [[ -z $stale ]] || echo "     changed: $stale — run down + up"
  fi
  ((ok)) && echo "doctor: slot $SLOT healthy" || { echo "doctor: slot $SLOT NOT healthy"; return 1; }
}

cmd_run() {
  local journey=${1:?usage: verify.sh run <journey> [args]}; shift
  local file="$SKILL_DIR/journeys/$journey.mjs"
  [[ -f $file ]] || { echo "verify: no journey $file" >&2; ls "$SKILL_DIR/journeys" >&2; exit 2; }
  cmd_doctor >/dev/null || { echo "verify: slot $SLOT is not healthy; run doctor" >&2; exit 1; }
  export VERIFY_EVIDENCE_DIR="$EVIDENCE_ROOT/$(date +%Y%m%d-%H%M%S)-s$SLOT-$journey"
  mkdir -p "$VERIFY_EVIDENCE_DIR"
  # Keep the server's side of the run (lap rejections, errors) with the evidence.
  local offset; offset=$(($(wc -c <"$RUN_DIR/server.log") + 1))
  local code=0
  node "$file" "$@" || code=$?
  tail -c "+$offset" "$RUN_DIR/server.log" >"$VERIFY_EVIDENCE_DIR/server.log"
  return "$code"
}

# Browser-free check: a server and database of its own (so it needs no `up` and disturbs
# no journey), driven by bots only. See scripts/smoke.mjs.
cmd_smoke() {
  local port=$((SERVER_PORT + 5)) db="${DB_NAME}_smoke"
  # Its own run directory: `down` on this slot removes the slot's, and may run meanwhile.
  local RUN_DIR="$EVIDENCE_ROOT/.run/smoke$SLOT"
  if port_busy "$port"; then echo "verify: port $port is held; pick another VERIFY_SLOT" >&2; exit 1; fi
  [[ -d "$REPO/node_modules" ]] || { echo "verify: run 'npm ci' first" >&2; exit 1; }
  export VERIFY_SERVER_PORT=$port
  VERIFY_DB_URL=$(node -e 'const u=new URL(process.argv[1]);u.pathname="/"+process.argv[2];console.log(u.toString())' "$ADMIN_URL" "$db")
  export VERIFY_DB_URL VERIFY_EVIDENCE_DIR="$EVIDENCE_ROOT/$(date +%Y%m%d-%H%M%S)-s$SLOT-smoke"
  mkdir -p "$RUN_DIR" "$VERIFY_EVIDENCE_DIR"
  pg admin "$ADMIN_URL" "DROP DATABASE IF EXISTS $db WITH (FORCE)"
  pg admin "$ADMIN_URL" "CREATE DATABASE $db"
  start smoke DATABASE_URL="$VERIFY_DB_URL" PORT="$port" npm run start -w @racing/server
  local code=0
  wait_for smoke "http://127.0.0.1:$port/healthz" 60 && node "$SKILL_DIR/scripts/smoke.mjs" || code=$?
  cp "$RUN_DIR/smoke.log" "$VERIFY_EVIDENCE_DIR/server.log"
  kill -TERM -- "-$(cat "$RUN_DIR/smoke.pid")" 2>/dev/null || true
  pg admin "$ADMIN_URL" "DROP DATABASE IF EXISTS $db WITH (FORCE)" || true
  rm -rf "$RUN_DIR"
  return "$code"
}

# Every journey (or the ones named) at once, each on its own slot: up, run, down.
cmd_all() {
  local journeys=("$@") out="$EVIDENCE_ROOT/.all"
  if ((${#journeys[@]} == 0)); then
    for file in "$SKILL_DIR"/journeys/*.mjs; do
      [[ $(basename "$file") == lib.mjs ]] || journeys+=("$(basename "$file" .mjs)")
    done
  fi
  ((${#journeys[@]} <= 10)) || { echo "verify: at most 10 journeys (slots 0-9)" >&2; exit 2; }
  rm -rf "$out"; mkdir -p "$out"
  local slot=0 code=0
  for journey in "${journeys[@]}"; do echo "$slot $journey"; slot=$((slot + 1)); done |
    xargs -P "${VERIFY_PARALLEL:-5}" -L 1 "$0" _one || code=$?
  echo "verify: journey output in $out/<journey>.log, evidence in $EVIDENCE_ROOT"
  return "$code"
}

cmd_one() { # slot journey — one line of cmd_all
  local slot=$1 journey=$2 out="$EVIDENCE_ROOT/.all/$2.log" code=0 t=$SECONDS
  # Only tear down a slot this call brought up: a refused `up` means someone else's instance
  # holds it, and a failed start has already cleaned up after itself.
  if VERIFY_SLOT=$slot "$0" up >"$out" 2>&1; then
    VERIFY_SLOT=$slot "$0" run "$journey" >>"$out" 2>&1 || code=$?
    VERIFY_SLOT=$slot "$0" down >>"$out" 2>&1 || true
  else
    code=1
  fi
  if ((code == 0)); then echo "ok   $journey ($((SECONDS - t)) s)"; else echo "FAIL $journey ($((SECONDS - t)) s) — see $out"; fi
  return "$code"
}

cmd_down() {
  for name in seam client server; do
    if alive "$name"; then kill -TERM -- "-$(cat "$RUN_DIR/$name.pid")" 2>/dev/null || true; fi
  done
  sleep 1
  for name in seam client server; do
    if alive "$name"; then kill -KILL -- "-$(cat "$RUN_DIR/$name.pid")" 2>/dev/null || true; fi
  done
  pg admin "$ADMIN_URL" "DROP DATABASE IF EXISTS $DB_NAME WITH (FORCE)" || true
  rm -rf "$RUN_DIR"
  echo "verify: slot $SLOT down (evidence kept in $EVIDENCE_ROOT)"
}

case ${1:-} in
  up) cmd_up ;;
  doctor) cmd_doctor ;;
  run) shift; cmd_run "$@" ;;
  sql) shift; pg query "${1:?usage: verify.sh sql \"<query>\"}" ;;
  # Headless protocol driver against this slot's server; JSON lines on stdout (see SKILL.md).
  bot) shift; cd "$REPO" && exec "$REPO/node_modules/.bin/tsx" "$SKILL_DIR/scripts/bot.ts" "$@" ;;
  smoke) cmd_smoke ;;
  all) shift; cmd_all "$@" ;;
  _one) shift; cmd_one "$@" ;;
  down) cmd_down ;;
  env) env | grep '^VERIFY_' | sort ;;
  *) sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
