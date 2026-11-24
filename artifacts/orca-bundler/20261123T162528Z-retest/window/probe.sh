#!/bin/bash
# usage: probe.sh <name>   fresh app launch -> isolation proof -> status -> shot
source "$(dirname "$0")/run.env"; source "$(dirname "$0")/tenv.sh"
D=$EV/$1; mkdir -p $D
nohup $EV/launch.sh $D >/dev/null 2>&1 &
sleep 9
A=$(cat $D/app.pid); C=$(pgrep -P $A -f 'herdr-core connect'); K=$(pgrep -f "$T/h/.local/bin/herdr-core --hc-launchd")
{ echo "APP=$A CONNECT=$C CORE=$K"; ps -o pid,ppid,lstart,command -p $A,$C,$K | cut -c1-240
  for p in $A $C $K; do echo "== lsof $p"; lsof -p $p 2>/dev/null | grep -E ' (cwd|txt)|\.sock|\.lock|core\.log|unix 0x.*->' | cut -c1-230; done
  echo "== user's live (read-only)"; ps -o pid,ppid,lstart,command -p 86842,86847,84630,90861 | cut -c1-240
  lsof -p 86842 -p 90861 2>/dev/null | grep -E '\.sock' | sort -u | cut -c1-230; } > $D/isolation.txt 2>&1
ps eww -p $A -o command= | tr ' ' '\n' | grep -E '^(HOME|HERDR_|HC_|OMP_|PI_)=' > $D/env-app.txt
tenv $HA status > $D/status.txt 2>&1; echo "status exit $?" >> $D/status.txt
tenv $HA shot $D/shot.png > $D/shot.out 2>&1; echo "shot exit $?" >> $D/shot.out
cat $D/status.txt $D/shot.out
