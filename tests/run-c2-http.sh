#!/usr/bin/env bash
# C2 HTTP battery runner (LOCAL ONLY): seeds local test keys, starts both
# Workers under wrangler dev, runs the frozen c2-http battery against them
# in the foreground, and tears the servers down. Readiness comes from
# wrangler's own "Ready on" log lines — never from HTTP polls, which would
# consume the very rate/quota budgets the battery measures (C1 lesson).
set -u
cd "$(dirname "$0")/.."
command -v pnpm >/dev/null || { echo "pnpm must be on PATH"; exit 2; }
[ -f apps/api/.dev.vars ] || { echo "apps/api/.dev.vars missing (CONTENT_JSON_B64 local content stand-in required)"; exit 2; }
grep -q CONTENT_JSON_B64 apps/api/.dev.vars || { echo "apps/api/.dev.vars lacks CONTENT_JSON_B64"; exit 2; }
cp apps/api/.dev.vars apps/mcp/.dev.vars 2>/dev/null || true
node tests/frozen/c2-seed.mjs || exit 2

API_LOG=/tmp/c2-api.log; MCP_LOG=/tmp/c2-mcp.log
: > "$API_LOG"; : > "$MCP_LOG"
(cd apps/api && pnpm exec wrangler dev --port 8787 --ip 127.0.0.1 --inspector-port 10787 > "$API_LOG" 2>&1) &
API_PID=$!
(cd apps/mcp && pnpm exec wrangler dev --port 8788 --ip 127.0.0.1 --inspector-port 10788 > "$MCP_LOG" 2>&1) &
MCP_PID=$!
cleanup() { kill $API_PID $MCP_PID 2>/dev/null; pkill -f "wrangler dev --port 878" 2>/dev/null; }
trap cleanup EXIT
for i in $(seq 1 90); do
  grep -q "Ready on http://127.0.0.1:8787" "$API_LOG" && grep -q "Ready on http://127.0.0.1:8788" "$MCP_LOG" && break
  sleep 1
done
grep -q "Ready on http://127.0.0.1:8787" "$API_LOG" || { echo "API never became ready; log:"; tail -20 "$API_LOG"; exit 1; }
grep -q "Ready on http://127.0.0.1:8788" "$MCP_LOG" || { echo "MCP never became ready; log:"; tail -20 "$MCP_LOG"; exit 1; }
sleep 1
API_URL=http://127.0.0.1:8787 MCP_URL=http://127.0.0.1:8788 node --test tests/frozen/c2-http.test.mjs
