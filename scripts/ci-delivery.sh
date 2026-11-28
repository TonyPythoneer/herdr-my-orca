#!/usr/bin/env bash
# Fetch or verify the CI delivery artifact built for one PR head commit.
#   fetch <dir>   wait for the CI run of $HEAD_SHA, download its artifact into <dir>, verify it
#   verify <dir>  verify an artifact already in <dir> against $HEAD_SHA
# Native workflows call this; they never compile the project.
set -euo pipefail
mode="${1:?usage: ci-delivery.sh fetch|verify <dir>}"
dir="${2:?usage: ci-delivery.sh fetch|verify <dir>}"
: "${HEAD_SHA:?HEAD_SHA is the PR head commit}"

verify() {
  (cd "$dir" && sha256sum -c herdr-my-orca.zip.sha256)
  python3 -I - "$dir" "$HEAD_SHA" <<'PY'
import hashlib, json, sys
from pathlib import Path

root, head = Path(sys.argv[1]), sys.argv[2]
manifest = json.loads((root / "manifest.json").read_text())
digest = hashlib.sha256((root / "herdr-my-orca.zip").read_bytes()).hexdigest()
assert manifest["schema"] == 1, manifest
assert manifest["pr_head_sha"] == head, (manifest["pr_head_sha"], head)
assert manifest["commit"] == head, (manifest["commit"], head)
assert manifest["zip_sha256"] == digest, "zip digest does not match manifest"
print(f"verified commit {head}, zip sha256 {digest}")
PY
}

if [ "$mode" = verify ]; then
  verify
  exit 0
fi

: "${GH_TOKEN:?}" "${REPO:?}"
deadline=$((SECONDS + 3600))
while :; do
  # The newest pull_request CI run for the head commit; a retry or cancelled run is not success.
  line="$(gh run list --repo "$REPO" --workflow ci.yml --event pull_request --limit 100 \
    --json databaseId,headSha,status,conclusion \
    | jq -r --arg sha "$HEAD_SHA" '[.[] | select(.headSha == $sha)][0] // empty | "\(.databaseId) \(.status) \(.conclusion // "")"')"
  read -r run_id status conclusion <<<"$line" || true
  if [ "${status:-}" = completed ]; then
    if [ "$conclusion" != success ]; then
      echo "::error::CI run ${run_id} concluded '${conclusion}' for ${HEAD_SHA}"
      exit 1
    fi
    break
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "::error::no completed CI run for ${HEAD_SHA} within 60 minutes"
    exit 1
  fi
  echo "waiting for CI on ${HEAD_SHA} (run=${run_id:-none}, status=${status:-none})"
  sleep 30
done

gh run download "$run_id" --repo "$REPO" -n "herdr-delivery-$HEAD_SHA" -D "$dir"
verify
