# Herdr check, per sample (S=/private/tmp/claude-501/rt-p2bm, samples in $S/samples/sN)
env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME=$S/home HERDR_TELEMETRY=0 /Users/tonyyang/Applications/Herdr.app/Contents/MacOS/Herdr check $S/samples/sN
# First run of s1 hit "isolated checker failed ... did not connect"; the retry and all of s1-s10 then succeeded.
# Token columns: node gen.mjs (writes tokens.json; byte col = Buffer.byteLength(prefix)+1)
