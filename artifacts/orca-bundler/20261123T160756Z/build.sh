#!/bin/sh
# usage: build.sh <srcbase> <toolnm> <baseline> <rootdir> <mode U|M>
# Builds both mods from <srcbase> in a clean <rootdir>, assembles <rootdir>/dist/mods/<orca-name>.
set -e
SRC=$1 NM=$2 BASE=$3 ROOT=$4 MODE=$5
rm -rf "$ROOT"; mkdir -p "$ROOT"
cp -R "$SRC/." "$ROOT/"; cp -cR "$NM" "$ROOT/node_modules" 2>/dev/null || cp -R "$NM" "$ROOT/node_modules"
cd "$ROOT"
for pair in panel-gap:orca-panel-gap agents:orca-agents; do
  m=${pair%%:*}; full=${pair##*:}
  ORCA_MOD=$m ORCA_MODE=$MODE ./node_modules/.bin/vp pack
  d=dist/mods/$full; mkdir -p $d
  cp out/$m/main.js out/$m/main.js.map $d/
  cp "$BASE/mods/$full/mod.json" $d/
  cp "$BASE/mods/$full"/*.svg $d/
done
