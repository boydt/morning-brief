#!/usr/bin/env python3
"""Copy real brief day files into data/ and regenerate data/index.json.

Usage: build_index.py [--src DIR] [--dest DIR]
  --src   where April writes day files (optional; if omitted only the index is rebuilt)
  --dest  the repo's data/ directory (default: <repo>/data)

Only files named YYYY-MM-DD.json whose JSON parses and whose title does NOT contain
"(sample)" are copied. requests.json and anything else is ignored. Writes use
tmp-file + rename. Prints a one-line JSON summary: {"added": [...], "updated": [...],
"details_only": bool} to stdout.
"""
import argparse, datetime, json, os, re, sys, tempfile, time

DAY_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})\.json$")
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)


def load(path, retries=5):
    for i in range(retries):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            if i == retries - 1:
                return None
            time.sleep(0.2)  # writer may be mid tmp+rename


def is_sample(day):
    return "(sample)" in str(day.get("title", "")).lower()


def items(day):
    for s in day.get("sections") or []:
        if isinstance(s, dict):
            for it in s.get("items") or []:
                if isinstance(it, dict):
                    yield it


def strip_details(day):
    d = json.loads(json.dumps(day))
    for it in items(d):
        it.pop("details_md", None)
        it.pop("details_updated", None)
    return d


def write_atomic(path, text):
    fd, tmp = tempfile.mkstemp(prefix="." + os.path.basename(path) + ".", suffix=".tmp", dir=os.path.dirname(path))
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


def dump(obj):
    return json.dumps(obj, indent=2, ensure_ascii=False) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src")
    ap.add_argument("--dest", default=os.path.join(REPO, "data"))
    a = ap.parse_args()
    os.makedirs(a.dest, exist_ok=True)
    added, updated, details_only = [], [], True

    if a.src:
        for name in sorted(os.listdir(a.src)):
            m = DAY_RE.match(name)
            if not m:
                continue
            day = load(os.path.join(a.src, name))
            if not isinstance(day, dict):
                print(f"warning: skipping unreadable {name}", file=sys.stderr)
                continue
            if is_sample(day):
                continue
            dest = os.path.join(a.dest, name)
            old = load(dest, retries=1) if os.path.exists(dest) else None
            if old == day:
                continue
            with open(os.path.join(a.src, name), encoding="utf-8") as f:
                raw = f.read()
            try:
                if json.loads(raw) != day:
                    raise ValueError("changed while reading")
            except ValueError:
                raw = dump(day)
            write_atomic(dest, raw if raw.endswith("\n") else raw + "\n")
            if old is None:
                added.append(m.group(1))
            else:
                updated.append(m.group(1))
                if strip_details(old) != strip_details(day):
                    details_only = False

    days = []
    for name in os.listdir(a.dest):
        m = DAY_RE.match(name)
        if not m:
            continue
        day = load(os.path.join(a.dest, name))
        if not isinstance(day, dict) or is_sample(day):
            continue
        its = list(items(day))
        days.append({
            "date": m.group(1),
            "title": day.get("title") or "Morning Brief",
            "headline_count": len(its),
            "deep_dive_count": sum(1 for it in its if isinstance(it.get("details_md"), str) and it["details_md"].strip()),
        })
    days.sort(key=lambda d: d["date"], reverse=True)
    index_path = os.path.join(a.dest, "index.json")
    old_index = load(index_path, retries=1) if os.path.exists(index_path) else None
    new_index = {"days": days}
    if not isinstance(old_index, dict) or old_index.get("days") != days:
        new_index["generated_at"] = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        write_atomic(index_path, dump(new_index))
    print(json.dumps({"added": added, "updated": updated, "details_only": bool(updated) and details_only and not added}))


if __name__ == "__main__":
    main()
