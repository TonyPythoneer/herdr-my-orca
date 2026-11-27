#!/bin/bash
# Run every test file alone and list each failing test as "<file><TAB><test name>".
# Per file, not the whole suite: a test that fails only because of its neighbours then shows up as a
# difference. Use it on the current tree and in a detached worktree of the previous commit.
# `comm -23 current.tsv base.tsv` lists new failures; use `cmp` to check whether both lists match.
#
#   scripts/failing-tests.sh [repo-dir] [out.tsv]        (defaults: ., failing-tests.tsv)
#
# Only the failing names are written. A file that cannot run at all shows up as its own line.
repo="${1:-.}"
out="${2:-failing-tests.tsv}"
cd "$repo" || exit 1
log="$(mktemp)"
: > "$out"
while IFS= read -r file; do
  timeout 120 node --test "$file" > "$log" 2>&1
  grep -E '^✖' "$log" | sed 's/ ([0-9.]*ms)//' | grep -v 'failing tests' | sort -u |
    while IFS= read -r name; do printf '%s\t%s\n' "$file" "$name" >> "$out"; done
done < <(git ls-files 'mods/*.test.js' 'mods/*.test.mjs' 'scripts/*.test.js' 'scripts/*.test.mjs' \
  'orca-ui/*.test.js' 'orca-ui/*.test.mjs' | sort -u)
sort -u "$out" -o "$out"
rm -f "$log"
echo "failing (file, test) pairs: $(wc -l < "$out" | tr -d ' ')"
