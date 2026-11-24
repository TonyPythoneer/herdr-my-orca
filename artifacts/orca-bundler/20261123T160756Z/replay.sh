#!/bin/sh
# Rebuild the offline Vite+ experiment from pinned commit c713c70. Run from the repo root.
# usage: replay.sh [outdir]   (default: a new mktemp dir under /private/tmp/claude-501)
# Does not touch ~/.config/herdr-app. Probe checks run with a scratch HOME and empty agent dirs.
set -e
EVID=$(cd "$(dirname "$0")" && pwd)
REPO=$(git -C "$EVID" rev-parse --show-toplevel)
LAB=${1:-$(mktemp -d /private/tmp/claude-501/orca-replay.XXXXXX)}; mkdir -p "$LAB/baseline" "$LAB/tool" "$LAB/home" "$LAB/empty-agent"
git -C "$REPO" archive --format=tar -o "$LAB/base.tar" c713c70 && tar -xf "$LAB/base.tar" -C "$LAB/baseline"
B=$LAB/baseline
# tool: Vite+ 1.7.0 (npm package vite-plus), exact pin, local CLI only
cp "$EVID/config/tool-package.json" "$LAB/tool/package.json"; cp "$EVID/config/tool-package-lock.json" "$LAB/tool/package-lock.json"
(cd "$LAB/tool" && npm ci && ./node_modules/.bin/vp --version)
# source tree: features import the one shared file
S=$LAB/srcbase; mkdir -p $S/src/features/panel-gap $S/src/features/agents $S/src/shared
cp $B/shared/panel-motion.js $S/src/shared/
sed 's#"./panel-motion.js"#"../../shared/panel-motion.js"#' $B/mods/orca-panel-gap/main.js > $S/src/features/panel-gap/main.js
sed 's#"./panel-motion.js"#"../../shared/panel-motion.js"#' $B/mods/orca-agents/main.js > $S/src/features/agents/main.js
cp "$EVID/config/package.json" "$EVID/config/vite.config.mjs" $S/
# healthy builds, each twice from clean dirs, then compare
for M in U M; do for r in 1 2; do sh "$EVID/build.sh" $S $LAB/tool/node_modules $B $LAB/b$M$r $M >/dev/null; done
  (cd $LAB/b${M}1/dist && find . -type f | sort | xargs shasum -a 256) > $LAB/m$M.1; (cd $LAB/b${M}2/dist && find . -type f | sort | xargs shasum -a 256) > $LAB/m$M.2
  cmp $LAB/m$M.1 $LAB/m$M.2 && echo "$M: two builds byte-identical"; done
# probes (fixtures)
cp -R $S $LAB/srcL; sed -i.bak '13a\
throw new Error("ORCA_PROBE_L");
' $LAB/srcL/src/features/panel-gap/main.js
cp -R $S $LAB/srcR; sed -i.bak '21a\
  throw new Error("ORCA_PROBE_R");' $LAB/srcR/src/shared/panel-motion.js
for P in L R; do for M in U M; do sh "$EVID/build.sh" $LAB/src$P $LAB/tool/node_modules $B $LAB/b$P$M $M >/dev/null; done; done
CHK="env HOME=$LAB/home OMP_CODING_AGENT_DIR=$LAB/empty-agent PI_CODING_AGENT_DIR=$LAB/empty-agent herdr-app check"
for P in L R; do for M in U M; do for m in orca-panel-gap orca-agents; do
  [ $P = L ] && [ $m = orca-agents ] && continue
  rm -rf $LAB/chk-$P$M-$m; cp -R $LAB/b$P$M/dist/mods/$m $LAB/chk-$P$M-$m
  echo "== $P $M $m"; $CHK $LAB/chk-$P$M-$m 2>&1 | grep -v WARN || true
done; done; done
echo "Decode a frame:  node $EVID/decode-bytecol.mjs <chk dir>/main.js <b..>/dist/mods/<m>/main.js.map <line> <col>"
echo "LAB=$LAB"
