#!/usr/bin/env python3
"""Report exact SVG duplicates in shipped mods; never mutate source or live config."""
import hashlib
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def audit(root):
    by_hash = defaultdict(list)
    by_name = defaultdict(set)
    sizes = {}
    for path in sorted((root / "mods").rglob("*.svg")):
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        by_hash[digest].append(path.relative_to(root).as_posix())
        by_name[path.name].add(digest)
        sizes[digest] = len(data)
    duplicates = [{"sha256": h, "paths": ps, "potential_saved_bytes": sizes[h] * (len(ps)-1)}
                  for h, ps in sorted(by_hash.items()) if len(ps) > 1]
    return {"schema":1, "scope":"shipped mods only; exact byte equality",
            "svg_files":sum(map(len, by_hash.values())), "unique_contents":len(by_hash),
            "duplicate_groups":duplicates, "potential_saved_bytes":sum(g["potential_saved_bytes"] for g in duplicates),
            "same_name_different_contents":sorted(name for name, hashes in by_name.items() if len(hashes)>1)}


if __name__ == "__main__":
    print(json.dumps(audit(ROOT), indent=2))
