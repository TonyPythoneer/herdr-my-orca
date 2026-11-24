#!/bin/zsh
S=/private/tmp/claude-501/-Users-tonyyang-git-herdr-my-orca-worktrees-orca-ui-package-plan/48bf2fa3-dd93-41fb-802d-da66d400375d/scratchpad
for n in 1 2 3; do for g in B C; do $S/exp/run-one.sh $g $n; python3 $S/exp/score.py $g $n > $S/exp/runs/$g$n/score.out 2>&1; done; done
echo done > $S/exp/driver.done
