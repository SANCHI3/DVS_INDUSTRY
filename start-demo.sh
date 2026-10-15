#!/usr/bin/env bash
# One-command demo: checks prerequisites, starts the backend and frontend (or
# reuses ones already running), then runs the CCTV perception service in demo
# mode on the clips in perception-service/demo_videos/.
#
#   ./start-demo.sh               demo clips
#   ./start-demo.sh --camera      live webcam instead
#   ./start-demo.sh --no-display  no OpenCV preview window
#
# Backend/frontend started by this script log to .demo-logs/ and are stopped
# when the script exits.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
PERCEPTION="$ROOT/perception-service"
LOGS="$ROOT/.demo-logs"
CAMERA=0
DISPLAY_FLAG=""
for arg in "$@"; do
  case "$arg" in
    --camera) CAMERA=1 ;;
    --no-display) DISPLAY_FLAG="--no-display" ;;
    *) echo "unknown option: $arg"; exit 2 ;;
  esac
done

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
ok()   { printf '    \033[32mOK\033[0m  %s\n' "$1"; }
warn() { printf '    \033[33m!!\033[0m  %s\n' "$1"; }
fail() { printf '\n    \033[31mFAILED: %s\033[0m\n' "$1"; [ -n "${2:-}" ] && printf '    \033[31mFix:    %s\033[0m\n' "$2"; exit 1; }

env_value() { grep -E "^\s*$2\s*=" "$1" 2>/dev/null | head -1 | sed -E "s/^\s*$2\s*=\s*//; s/^[\"']//; s/[\"']\s*$//" || true; }
port_open() { (exec 3<>"/dev/tcp/$1/$2") 2>/dev/null && exec 3>&- ; }
healthy() { curl -fsS --max-time 3 "$1" 2>/dev/null | grep -q '"status":"ok"'; }

PIDS=()
cleanup() { for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT

PY=python3; command -v python3 >/dev/null || PY=python

step "Checking tools"
for tool in node npm curl "$PY"; do
  command -v "$tool" >/dev/null || fail "'$tool' is not on PATH" "Install Node.js 20+, Python 3.10-3.12 and curl"
done
ok "node $(node --version), $($PY --version)"

step "Checking .env files"
[ -f "$BACKEND/.env" ] && [ -f "$PERCEPTION/.env" ] || \
  fail "backend/.env or perception-service/.env is missing" \
       "node scripts/setup.mjs --db-url \"postgresql://postgres:<password>@localhost:5432/dvs_factory\" --install"
ok "backend/.env and perception-service/.env found"
[ -n "$(env_value "$PERCEPTION/.env" DASHBOARD_SERVICE_EMAIL)$(env_value "$PERCEPTION/.env" DASHBOARD_API_TOKEN)" ] || \
  warn "perception-service/.env has no dashboard login: incidents are saved locally but NOT shown on the dashboard"
[ -n "$(env_value "$PERCEPTION/.env" LLM_API_KEY)" ] || warn "No LLM_API_KEY: alerts use the built-in plain-language description (this is fine)"

step "Checking PostgreSQL"
DB_URL="$(env_value "$BACKEND/.env" DATABASE_URL)"
[ -n "$DB_URL" ] || fail "DATABASE_URL is not set in backend/.env" "Re-run scripts/setup.mjs or copy backend/.env.example"
DB_HOST="$(sed -E 's#^[^@]*@([^:/?]+).*#\1#' <<<"$DB_URL")"
DB_PORT="$(sed -nE 's#^[^@]*@[^:/?]+:([0-9]+).*#\1#p' <<<"$DB_URL")"; DB_PORT="${DB_PORT:-5432}"
port_open "$DB_HOST" "$DB_PORT" || fail "PostgreSQL is not reachable at $DB_HOST:$DB_PORT" \
  "Start PostgreSQL (e.g. sudo systemctl start postgresql) or fix DATABASE_URL in backend/.env"
ok "PostgreSQL is listening on $DB_HOST:$DB_PORT"

step "Checking dependencies"
[ -d "$BACKEND/node_modules" ] || fail "backend dependencies are not installed" "cd backend && npm install && npx prisma generate && npx prisma migrate deploy && npm run db:seed"
[ -d "$FRONTEND/node_modules" ] || fail "frontend dependencies are not installed" "cd frontend && npm install"
(cd "$PERCEPTION" && $PY -c "import sklearn, torch, ultralytics, supervision, cv2, yaml" 2>/dev/null) || \
  fail "Python packages for the perception service are missing" "cd perception-service && pip install -r requirements.txt"
ok "node_modules present, Python packages importable"
GPU="$(cd "$PERCEPTION" && $PY -c "import torch; print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else '')" 2>/dev/null || true)"
if [ -n "$GPU" ]; then ok "GPU: $GPU"; else warn "No CUDA GPU found: models run on the CPU (slower, but everything works)"; fi
FIGHT="$PERCEPTION/models/fight_r3d18_v2.pt"
if [ ! -f "$FIGHT" ] || [ "$(wc -c <"$FIGHT")" -lt 1024 ]; then
  warn "Fight model is missing or a Git LFS pointer: fight detection disabled, other detectors still run. Fix: git lfs install && git lfs pull"
fi

if [ "$CAMERA" -eq 0 ]; then
  step "Checking demo clips"
  count_clips() { find "$PERCEPTION/demo_videos" -maxdepth 1 -type f \( -iname '*.mp4' -o -iname '*.avi' -o -iname '*.mov' -o -iname '*.mkv' -o -iname '*.webm' -o -iname '*.m4v' \) 2>/dev/null | wc -l; }
  [ "$(count_clips)" -gt 0 ] || (cd "$PERCEPTION" && $PY scripts/prepare_demo_videos.py)
  [ "$(count_clips)" -gt 0 ] || fail "no demo videos in perception-service/demo_videos/" \
    "Add 4 short clips (normal, fight, fire, fall) as described in perception-service/demo_videos/README.md"
  ok "$(count_clips | tr -d ' ') clip(s) found"
fi

mkdir -p "$LOGS"
step "Backend"
PORT="$(env_value "$BACKEND/.env" PORT)"; PORT="${PORT:-3000}"
HEALTH="http://localhost:$PORT/api/v1/health"
if healthy "$HEALTH"; then
  ok "already running on port $PORT (reusing it)"
else
  port_open localhost "$PORT" && fail "port $PORT is in use by another program" "Stop it, or change PORT in backend/.env"
  (cd "$BACKEND" && npm run dev >"$LOGS/backend.log" 2>&1) & PIDS+=($!)
  echo "    starting (log: .demo-logs/backend.log) ..."
  for _ in $(seq 45); do healthy "$HEALTH" && break; sleep 2; done
  healthy "$HEALTH" || fail "backend did not become healthy within 90 s" "See .demo-logs/backend.log (database migrated? cd backend && npx prisma migrate deploy)"
  ok "backend healthy at $HEALTH"
fi

step "Frontend"
if port_open localhost 5173; then
  ok "already running at http://localhost:5173 (reusing it)"
else
  (cd "$FRONTEND" && npm run dev >"$LOGS/frontend.log" 2>&1) & PIDS+=($!)
  echo "    starting (log: .demo-logs/frontend.log) ..."
  for _ in $(seq 30); do port_open localhost 5173 && break; sleep 2; done
  port_open localhost 5173 || fail "frontend did not start within 60 s" "See .demo-logs/frontend.log"
  ok "frontend running at http://localhost:5173"
fi

step "Perception service"
echo "    Open http://localhost:5173, log in as admin, open Security. Alerts appear as the clips play."
echo "    Press q in the video window or Ctrl+C to stop."
ARGS=(main.py --camera CAM-01)
[ "$CAMERA" -eq 1 ] || ARGS+=(--demo)
[ -z "$DISPLAY_FLAG" ] || ARGS+=("$DISPLAY_FLAG")
# A native crash (seen intermittently with CPU-only PyTorch) restarts the
# service, so a live demo recovers by itself. q / Ctrl+C exit normally.
cd "$PERCEPTION"
for attempt in 1 2 3 4 5; do
  code=0; $PY "${ARGS[@]}" || code=$?
  # restart only on native crashes (139 = segfault, 134 = abort)
  { [ "$code" -eq 139 ] || [ "$code" -eq 134 ]; } || break
  warn "perception service exited with code $code -- restarting ($attempt/5)"
  sleep 2
done
