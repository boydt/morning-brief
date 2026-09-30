#!/usr/bin/env bash
# Local preview: serve this repo as plain static files on http://127.0.0.1:${PORT:-8787}/
# Usage: tools/preview.sh [start|stop|status]
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8787}"
PIDFILE="${TMPDIR:-/tmp}/morning-brief-preview-$PORT.pid"
LOG="${TMPDIR:-/tmp}/morning-brief-preview-$PORT.log"

stop() {
  # The old Node server from /workspace/news-site used this port; stop it if present.
  [[ -x /workspace/news-site/start.sh ]] && /workspace/news-site/start.sh stop >/dev/null 2>&1 || true
  if [[ -f "$PIDFILE" ]]; then kill "$(cat "$PIDFILE")" 2>/dev/null || true; rm -f "$PIDFILE"; fi
  pkill -f "http.server $PORT --bind 0.0.0.0 --directory $REPO" 2>/dev/null || true
  for _ in $(seq 1 30); do (echo > "/dev/tcp/127.0.0.1/$PORT") 2>/dev/null || break; sleep 0.1; done
}
status() { curl -fsS -o /dev/null -w "preview: HTTP %{http_code} on http://127.0.0.1:$PORT/\n" "http://127.0.0.1:$PORT/data/index.json"; }
start() {
  stop
  setsid nohup python3 -m http.server "$PORT" --bind 0.0.0.0 --directory "$REPO" >>"$LOG" 2>&1 < /dev/null &
  echo $! > "$PIDFILE"
  for _ in $(seq 1 50); do curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null && break; sleep 0.1; done
  status
}
case "${1:-start}" in start|restart) start ;; stop) stop; echo "preview stopped" ;; status) status ;; *) echo "usage: $0 [start|stop|status]"; exit 2 ;; esac
