#!/usr/bin/env bash
# Sync April's real day files into this repo, rebuild data/index.json, commit and push.
#   SRC   where April writes (default /workspace/news-site/data)
#   Only YYYY-MM-DD.json files whose title does not contain "(sample)" are copied;
#   requests.json and everything else is ignored.
# Exit codes: 0 = synced/pushed or nothing to do, 1 = git push failed, 2 = other error.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${SRC:-/workspace/news-site/data}"
cd "$REPO"

[[ -d "$SRC" ]] || { echo "sync: source folder not found: $SRC" >&2; exit 2; }
summary="$(python3 "$REPO/tools/build_index.py" --src "$SRC" --dest "$REPO/data")" || { echo "sync: build_index.py failed" >&2; exit 2; }
echo "sync: $summary"

git add -A data
if git diff --cached --quiet; then
  echo "sync: no changes in data/"
  # Nothing new, but push any earlier commits that never made it (e.g. a previous push failed).
  if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1 && [[ -z "$(git log '@{u}..HEAD' --oneline 2>/dev/null)" ]]; then
    exit 0
  fi
  echo "sync: local commits not on origin/main yet; pushing them"
else
  msg="$(python3 - "$summary" <<'PY'
import json, sys
s = json.loads(sys.argv[1])
if s["added"]:
    print("Brief " + max(s["added"]))
elif s["updated"] and s["details_only"]:
    print("Update deep dives")
elif s["updated"]:
    print("Update brief " + ", ".join(sorted(s["updated"])))
else:
    print("Update index")
PY
)"
  git commit -q -m "$msg"
  echo "sync: committed \"$msg\" ($(git rev-parse --short HEAD))"
fi

if ! git push -u origin main; then
  echo "sync: ERROR: git push origin main failed — the commit is saved locally and will be pushed on the next successful sync. Check 'gh auth status' and network." >&2
  exit 1
fi
echo "sync: pushed to origin/main ($(git rev-parse --short HEAD))"
