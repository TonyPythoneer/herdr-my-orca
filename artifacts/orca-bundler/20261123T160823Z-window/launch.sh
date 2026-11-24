#!/bin/bash
# usage: launch.sh <probe-dir>; writes <probe-dir>/app.pid (the Herdr PID itself, via exec)
source "$(dirname "$0")/run.env"; source "$(dirname "$0")/tenv.sh"
mkdir -p "$1"; echo $$ > "$1/app.pid"
exec "${TENV[@]}" "$HA" > "$1/app.log" 2>&1
