#!/bin/sh
# fake-agent.sh: a pure-shell fake opencode / claude / codex for the Runner tests.
# It follows the dispatch file in the pointer prompt. Modes (ORCA_FAKE_MODE):
#   report (default)  ack, work, commit+push, write result/review
#   noack             same, but no .ack file (delivery evidence must be "working")
#   silent            no OSC status, no ack, no result; sleep
#   block             report OSC blocked and sleep
#   noresult          ack, then exit without a result
#   commit-nopush     commit but do not push, then write a result
#   after-result      write a result, then keep changing a file until killed
#   failtest          write a result but do not create the file the test checks
#   blockedresult     write a result with status "blocked"
set -u

find_arg() {
  for a in "$@"; do
    case "$a" in
      Read\ *dispatch/*.md*) printf '%s' "$a" ;;
    esac
  done
}

prompt=$(find_arg "$@")
if [ -z "$prompt" ]; then
  # claude / codex pass the pointer prompt as the last argument
  eval "last=\${$#}"
  prompt=$last
fi
md=$(printf '%s' "$prompt" | sed -n 's/^Read \(.*dispatch\/[A-Za-z0-9]*\.md\).*/\1/p')
[ -n "$md" ] || { echo "fake-agent: no dispatch path in prompt: $prompt" >&2; exit 2; }
[ -f "$md" ] || { echo "fake-agent: missing dispatch file $md" >&2; exit 2; }
id=$(basename "$md" .md)
state=$(dirname "$(dirname "$md")")
ack="$state/results/$id.ack"
result="$state/results/$id.json"
review="$state/reviews/$id.json"
mode=${ORCA_FAKE_MODE:-report}
role=dev
grep -q '^# Tuning dispatch' "$md" && role=tuning

case "$mode" in
  noack|silent) ;;
  *) : > "$ack" ;;
esac

case "$mode" in
  silent) sleep 600; exit 0 ;;
  block) printf '\033]7501;state=blocked:app=fake:kind=question\007'; sleep 600; exit 0 ;;
  noresult) exit 0 ;;
esac

printf '\033]7501;state=working:app=fake\007'

if [ "$role" = tuning ]; then
  verdict=${ORCA_FAKE_VERDICT:-pass}
  if [ "$mode" = fix-once ] && [ ! -f "$state/.fake-fixed" ]; then
    printf 'tuning fix\n' > tuning-fix.txt
    git add -A >/dev/null 2>&1 || true
    git commit -m "orca(TUNING): fake fix" >/dev/null 2>&1 || true
    git push >/dev/null 2>&1 || true
    : > "$state/.fake-fixed"
  fi
  if [ "$verdict" = rework-once ]; then
    if [ -f "$state/.fake-reworked" ]; then verdict=pass; else verdict=rework; : > "$state/.fake-reworked"; fi
  fi
  crit=$(grep '^- AC-' "$md" | sed -n 's/^- \([A-Za-z0-9-]*\):.*/"\1"/p' | paste -sd, -)
  [ -n "$crit" ] || crit='"AC-1"'
  criteria=""
  oldIFS=$IFS; IFS=,
  for c in $crit; do
    criteria="$criteria${criteria:+,}{\"id\":$c,\"pass\":true,\"evidence\":\"fake\"}"
  done
  IFS=$oldIFS
  if [ "$verdict" = rework ] && [ -n "${ORCA_FAKE_REWORK:-}" ]; then
    new_tasks=$ORCA_FAKE_REWORK
  else
    new_tasks='[{"title":"fake rework","test":"test -f fake-R1-01.txt","deps":[]}]'
  fi
  cat > "$review" <<EOF
{"dispatch":"$id","verdict":"$verdict","criteria":[$criteria],"new_tasks":$new_tasks,"summary":"fake tuning"}
EOF
  printf '\033]7501;state=idle:app=fake\007'
  exit 0
fi

task=$(sed -n '1s/.*— //p' "$md")
[ -n "$task" ] || task=T-01
if [ "$mode" != failtest ]; then
  printf 'fake %s\n' "$task" > "fake-$task.txt"
fi
git add -A >/dev/null 2>&1 || true
git commit -m "orca($task): fake" >/dev/null 2>&1 || true
if [ "$mode" != commit-nopush ]; then
  git push >/dev/null 2>&1 || true
fi
sha=$(git rev-parse HEAD 2>/dev/null || echo none)
status=done
[ "$mode" = blockedresult ] && status=blocked
cat > "$result" <<EOF
{"dispatch":"$id","task":"$task","status":"$status","summary":"fake worker","commits":["$sha"],"test":{"cmd":"test -f fake-$task.txt","exit":0}}
EOF
printf '\033]7501;state=idle:app=fake\007'

if [ "$mode" = after-result ]; then
  while :; do printf 'x\n' >> late.txt; sleep 1; done
fi
exit 0
