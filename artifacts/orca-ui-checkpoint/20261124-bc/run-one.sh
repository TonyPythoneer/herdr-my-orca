#!/bin/zsh
# usage: run-one.sh <B|C> <n>
set -u
S=/private/tmp/claude-501/-Users-tonyyang-git-herdr-my-orca-worktrees-orca-ui-package-plan/48bf2fa3-dd93-41fb-802d-da66d400375d/scratchpad
G=$1; N=$2; D=$S/exp/runs/$G$N
rm -rf $D; mkdir -p $D
if [ "$G" = B ]; then SRC=$S/exp/base; else SRC=$S/exp/c; fi
cp -R $SRC $D/work; cd $D/work
git init -q . && git add -A && git -c user.name=snap -c user.email=snap@example.invalid commit -q -m "starting snapshot"
[ "$G" = C ] && mkdir -p orca-ui/features
start=$(date +%s)
env $(env | grep -oE '^(HERDR|OMP|PI_CODING)[A-Za-z_]*' | sed 's/^/-u /' | tr '\n' ' ') PATH="$S/bin:$PATH" \
  timeout 1500 claude -p "$(cat $S/exp/prompt.txt)" --model claude-haiku-5-5 --strict-mcp-config --setting-sources project \
  --no-session-persistence --disable-slash-commands --tools "Bash,Read,Edit,Write" --allowedTools "Bash,Read,Edit,Write" \
  --output-format stream-json --verbose --permission-mode default < /dev/null > $D/log.jsonl 2> $D/err.txt
echo "rc=$? seconds=$(( $(date +%s) - start ))" > $D/run.txt
