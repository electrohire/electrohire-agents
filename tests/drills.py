#!/usr/bin/env python3
"""C-05 recorded drills (LOCAL ONLY). Starts throwaway wrangler-dev API
instances with drill-specific vars, exercises the kill switches and the
per-IP rate limit, and tears each instance down. Run from the repo root:
    python3 tests/drills.py
"""
import json, os, subprocess, sys, time, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API_DIR = os.path.join(ROOT, "apps", "api")
import shutil
PNPM = shutil.which("pnpm") or "pnpm"  # any pnpm on PATH
_devvars = os.path.join(API_DIR, ".dev.vars")
if not os.path.exists(_devvars):
    sys.exit("drills need apps/api/.dev.vars with CONTENT_JSON_B64=<base64 of the website's /content/v1.json> (local content stand-in)")

def port_free(port):
    import socket
    with socket.socket() as sock:
        return sock.connect_ex(("127.0.0.1", port)) != 0

def start(port, extra_vars):
    if not port_free(port):
        raise SystemExit(f"drill port {port} is already in use — a leftover server would poison the drill; free it first")
    # Content comes from apps/api/.dev.vars (CONTENT_JSON_B64). It is NOT
    # passed as a --var argument: a ~21 KB CLI var value silently breaks
    # wrangler's parsing of the drill vars that follow it (found in C1
    # drills, 2026-10-24 — the rate-limit var never reached the Worker).
    args = [PNPM, "exec", "wrangler", "dev", "--port", str(port), "--ip", "127.0.0.1",
            "--inspector-port", str(port + 2000)]
    for k, v in extra_vars.items():
        args += ["--var", f"{k}:{v}"]
    proc = subprocess.Popen(args, cwd=API_DIR, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, start_new_session=True)
    url = f"http://127.0.0.1:{port}"
    want = 503 if extra_vars.get("GLOBAL_KILL_SWITCH") == "1" else 200
    for _ in range(90):
        try:
            if req(url + "/v1/health")[0] == want: return proc, url
        except Exception:
            pass
        time.sleep(1)
    raise SystemExit(f"drill instance on {port} never answered health with {want}")

def req(url, data=None):
    r = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None,
                               headers={"content-type": "application/json"}, method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(r, timeout=10) as resp: return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")

def stop(proc):
    try: os.killpg(os.getpgid(proc.pid), 15)
    except Exception: pass
    try: proc.wait(timeout=10)
    except Exception: pass

results = []
def check(name, ok, detail):
    results.append((name, ok, detail)); print(f"{'PASS' if ok else 'FAIL'} {name}: {detail}")

# Drill 1 — rate limit trips (limit 3/minute on this instance)
proc, url = start(8791, {"RATE_LIMIT_PER_MINUTE": "3"})
try:
    # start()'s readiness poll was request #1 against the limit of 3, so
    # two more 200s are expected and the limit must trip after that.
    codes = [req(url + "/v1/health")[0] for _ in range(5)]
    check("rate-limit trips", codes[:2] == [200, 200] and all(c == 429 for c in codes[2:]), f"sequence (after 1 readiness poll) {codes}")
finally: stop(proc)

# Drill 2 — one tool off while others serve
proc, url = start(8792, {"DISABLED_TOOLS": "cost-estimator"})
try:
    est = req(url + "/v1/tools/cost-estimator", {"needs": ["pcb"]})[0]
    faq = req(url + "/v1/faq")[0]
    check("per-tool kill switch", est == 503 and faq == 200, f"estimator={est} faq={faq}")
finally: stop(proc)

# Drill 3 — global off, then back on (fresh instance without the flag)
proc, url = start(8793, {"GLOBAL_KILL_SWITCH": "1"})
try:
    off = req(url + "/v1/health")[0]
finally: stop(proc)
proc, url = start(8794, {})
try:
    on = req(url + "/v1/health")[0]
    check("global kill switch off->on", off == 503 and on == 200, f"off={off} back_on={on}")
finally: stop(proc)

failed = [r for r in results if not r[1]]
print(f"DRILLS {'PASS' if not failed else 'FAIL'} ({len(results) - len(failed)}/{len(results)})")
sys.exit(1 if failed else 0)
