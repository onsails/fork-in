#!/usr/bin/env bash
# Self-contained warm/cold cache proof. Uses the REAL omp config/auth
# (provider cache semantics need a real provider), isolated session trees
# via --session-dir, reads message.usage (assistant entries).
set -euo pipefail
repo=/home/wb/dev/os/fork-in
root=$(mktemp -d /tmp/cache-proof-v3-XXXXXX)
srcdir="$root/src"; warmdir="$root/warm"; colddir="$root/cold"
mkdir -p "$srcdir" "$warmdir" "$colddir"

usage_rows() { # $1 file — prints one line per turn
python3 - "$1" <<'EOF'
import json, sys
rows = []
for line in open(sys.argv[1]):
    try: e = json.loads(line)
    except Exception: continue
    m = e.get("message") if e.get("type") == "message" else None
    u = m.get("usage") if isinstance(m, dict) else None
    if isinstance(u, dict) and "input" in u:
        rows.append({k: u.get(k) for k in ("input","output","cacheRead","cacheWrite")})
for r in rows:
    print("   ", r)
EOF
}

cd "$repo"
echo "[1] building source session"
timeout 150 omp -p --session-dir "$srcdir" "Read package.json and reply with only its name field value." >/dev/null 2>&1 || true
timeout 150 omp -p --session-dir "$srcdir" -c "Reply with only the word count of the name field." >/dev/null 2>&1 || true
src=$(ls -t "$srcdir"/*.jsonl | head -1)
echo "    source: $(basename "$src")"; usage_rows "$src"

echo "[2] forking warm + cold"
warm=$(bun run "$repo/scripts/fork.ts" "$src"); cold=$(bun run "$repo/scripts/fork-cold.ts" "$src")
warm_file=$(jq -r .file <<<"$warm"); warm_id=$(jq -r .newId <<<"$warm")
cold_file=$(jq -r .file <<<"$cold"); cold_id=$(jq -r .newId <<<"$cold")
mv "$warm_file" "$warmdir/"; [ -d "${warm_file%.jsonl}" ] && mv "${warm_file%.jsonl}" "$warmdir/" || true
mv "$cold_file" "$colddir/"

probe() { # $1 dir $2 id $3 label
  timeout 150 omp -p --session-dir "$1" --resume "$2" "Reply with exactly one word: ok" >/dev/null 2>&1 || true
  echo "[3:$2 fork-turn usage in $1]"
  usage_rows "$1/$2.jsonl"
}
probe "$warmdir" "$warm_id" warm
probe "$colddir" "$cold_id" cold
echo "root=$root"
