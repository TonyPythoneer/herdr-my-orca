# Orca bundler offline experiment (reduced spec subset)

Run id: 20261123T160756Z. Evidence dir: /Users/tonyyang/git/herdr-my-orca.worktrees/orca-ui-package-plan/artifacts/orca-bundler/20261123T160756Z. Pinned source: c713c70 (git archive). Lab: /private/tmp/claude-501/orca-bundler.X7bUqY (scratch, not in repo). Nothing committed or pushed; no tracked file edited; ~/.config/herdr-app never written; no Herdr window opened or commanded (no herdr-app status/shot/do/ls); only `herdr-app check` on scratch copies.
Scope: offline only. No isolated Herdr window, so no UI text/icon/interaction check, no E probe, no negative map controls, no F (vp build) run. Those are NOT done, not PASS.

## 1. Versions (logs/00-versions.log)
- macOS 27.2.1 arm64 (Darwin 27.2.0); Node v26.13.1; package manager npm 11.20.0 (install: `npm install -D --save-exact vite-plus@1.7.0`; lockfile in config/tool-package-lock.json)
- Vite+ CLI: vite-plus 1.7.0 (npm package `vite-plus`, local binary `./node_modules/.bin/vp`; no global CLI, no vite/vitest overrides since only `vp pack` is used)
- Engine reported by `vp --version`: tsdown v0.23.4, rolldown v1.2.19 (vite v8.3.8, oxlint 1.94.0, oxfmt 0.79.0, vitest 5.1.0). `vp pack` itself was used for every build; no stand-in.
- Herdr: `herdr-app check` header reports gpui-shell 0.7.1 (core version not queried because only check is allowed).

## 2. Build config (config/vite.config.mjs, build.sh)
Command per mod: `ORCA_MOD=<panel-gap|agents> ORCA_MODE=<U|M> ./node_modules/.bin/vp pack` (logs/11..12-build-*.log). Config `pack`: entry {main: src/features/<mod>/main.js}, format [esm], platform neutral, dts false, minify (M only), sourcemap true (external .map + `//# sourceMappingURL=main.js.map`), `deps.neverBundle` = herdr, gpui-kit, gpui-base, fixedExtension false (so output is main.js not .mjs), clean true. A config using `external` works but prints "external is deprecated. Use deps.neverBundle"; I used deps.neverBundle. vp requires a package.json in the root (first attempt failed: "Package not found in workspace").
Source tree: src/features/{panel-gap,agents}/main.js are the c713c70 main.js files with ONE line changed (`./panel-motion.js` -> `../../shared/panel-motion.js`); src/shared/panel-motion.js = c713c70 shared/panel-motion.js. Baseline copies verified = shared + 1-line header (tail -n +2 cmp), and baseline JS blobs = git blobs (git hash-object).
Assembled output: dist/mods/<orca-name>/{main.js, main.js.map, mod.json, *.svg} (mod.json and svgs copied from c713c70 at original names).

## 3. Size table (size-table.md; bytes from stat; A = main.js + panel-motion.js copy per mod; tests excluded)
| mod | A JS bytes (main+panel-motion) | U JS bytes (saving) | M JS bytes (saving) | U map bytes | M map bytes |
|---|---|---|---|---|---|
| orca-panel-gap | 4727 | 2307 (51.2%) | 1824 (61.4%) | 6785 | 7001 |
| orca-agents | 30953 | 17517 (43.4%) | 12408 (59.9%) | 48948 | 50296 |
| TOTAL | 35680 | 19824 (44.4%) | 14232 (60.1%) | 55733 | 57297 |

Saving vs A = (A-X)/A. U = unminified, M = minified.
- panel-motion inlined: yes in both U and M bundles of both mods (U output contains "// src/shared/panel-motion.js" section and no import of it; M has no panel-motion import and the .map sources list ../../src/shared/panel-motion.js). It is therefore still duplicated once per mod (2 copies total), same as A.
- Host imports remain external in all outputs: only `gpui-kit`, `gpui-base`, `herdr` imports (herdr imports are merged to one statement per file).
- Two builds from two clean dirs: U byte-identical (every file, manifests/manifest-bU1.tsv vs bU2.tsv, relative path+bytes+sha256), M byte-identical (manifest-bM1 vs bM2). The replay run also reproduced the same M hash (d4ead8ee...).
- Map bytes are outside JS bytes: U maps 55,733 / M maps 57,297 total. Total published tree excl. tests (JS+maps+mod.json+svgs): A 39,341; U 79,218; M 75,190. So the published tree roughly doubles when maps ship, while Herdr runtime JS shrinks (Herdr reading the .map at runtime was not tested).
- Caveat on savings: A->U (-15,856 B) is mostly NOT structural. `vp pack` strips comments: A's whole-line `//` comments alone are about 12.3 KB (grep count across both main.js plus one panel-motion copy; trailing comments not counted). U->M (-5,592 B) is the minifier. Savings do not imply faster startup (not measured).
- Config/dependency cost vs A: 1 vite.config + package.json + lockfile with vite-plus (npm installed 80 packages), 1 changed import line per feature, build.sh to assemble output; the sync-shared copy+header step is not needed for these two mods in the bundled scheme. Only 2 mods tested; no claim for the other 3 consumers of panel-motion.

## 4. Healthy check (logs/21..26-check-healthy-*.log)
| folder | exit | output |
|---|---|---|
| A panel-gap | 0 | check passed |
| A agents | 0 | check passed; WARN "mod exec'd sh; the child runs for real"; WARN stranded script tasks |
| U panel-gap | 0 | check passed |
| U agents | 0 | check passed + same 2 WARN as A |
| M panel-gap | 0 | check passed |
| M agents | 0 | check passed + same 2 WARN as A |
Disclosure: these six healthy checks (and only these) ran with my real HOME and real agent env, before I switched to a scratch HOME + empty OMP_CODING_AGENT_DIR/PI_CODING_AGENT_DIR. Agents' check really executes `sh` (WARN above), so it may have read real agent session dirs read-only; I did not inspect or save any of that. All later checks used HOME=scratch and empty agent dirs. I did not verify whether check writes under ~/.config/herdr-app. Check writes gpui-kit.d.ts and jsconfig.json only into the scratch copies.
Not done: independence test (remove other mod's JS and reload) was not run; U and M each have only main.js plus own mod.json/svgs in their folder and import nothing relative, which is consistent with, but not proof of, standalone loading.

## 5. Frame format calibration (logs/30..32-known-*.log)
Herdr frame: `at <fn> (<abs path>/main.js?v=1:LINE:COL)`; message has no "Error:" prefix. LINE is 1-based. COL is 1-based but only approximately at the token: with `throw new Error` it landed on the E in one sample (m1: 11) and 1 before it in another (m8: 27 vs E=28); with `throw Error(` it lands on the space before Error (m3: 6). Treat COL as +-1.
Important: COL counts UTF-8 BYTES, not UTF-16 units. m7 `const s="—···";throw new Error("S7");` (5 extra bytes before the throw): reported 30; m8 same line with ASCII: 27, i.e. the same -1 offset relative to the byte column of E (31 vs 28). The spec's snippet (col-1 into SourceMap.findEntry, which uses UTF-16 columns) is therefore wrong for lines with non-ASCII before the frame. decode-bytecol.mjs converts byte->UTF-16 first. Sources: logs/31-known-m3..m6, logs/32-known-m7,m8.

## 6. Probe table
Truth (fixtures/truth.tsv): L = src/features/panel-gap/main.js:14 (fixtures: probe-L.patch). R = shared/panel-motion.js:22 (probe-R.patch); render callers: panel-gap main.js:40, agents main.js:457 (unchanged by the probe).
Decode = decode-bytecol.mjs (byte col -> UTF-16 col -> node:module SourceMap.findEntry, 1-based out). "naive" = spec snippet col-1 with no byte conversion. Map sources are written as ../../src/... relative to the build's out/<mod>/ dir, not to the published folder.

| token | variant | true source:line | Herdr raw frame(s) | decoded | result |
|---|---|---|---|---|---|
| L | A (no bundler) | n/a | (not run; L only built via vp) | | N/A |
| L | U | src/features/panel-gap/main.js:14 | main.js?v=1:27:11 | panel-gap/main.js 14:11 | PASS (logs/41-check-L-U.log, 63-decode) |
| L | M | src/features/panel-gap/main.js:14 | main.js?v=1:1:55 | panel-gap/main.js 14:1 (cols 54-55 -> 14:1, 56-57 -> 14:11; line 14 either way) | PASS, unambiguous line. Caveat: bundle is degenerate (top-level throw makes the minifier emit only `import"gpui-kit";import"gpui-base";import"herdr";throw Error(...)`), so there is nothing else to be confused with |
| R | A, panel-gap | shared/panel-motion.js:22 | panel-motion.js?v=1:23:13 ; main.js?v=1:40:37 | native: panel-motion.js line 23 = shared line 22 + 1 (header line); main.js:40 = true render line | native file:line, +1 offset as expected; points at the generated copy, not shared/ (logs/50-check-R-A-orca-panel-gap.log) |
| R | A, agents | shared/panel-motion.js:22 | panel-motion.js?v=1:23:13 ; main.js?v=1:457:50 | same, +1; render line 457 true | same as above (logs/50-check-R-A-orca-agents.log). Check DID reach render in A and bundles |
| R | U, panel-gap | shared:22 | main.js?v=1:7:12 ; 35:26 | src/shared/panel-motion.js 22:13 ; panel-gap/main.js 40:37 | PASS offline decode (native frame is only main.js generated coords; Herdr did not resolve to source) |
| R | U, agents | shared:22 | main.js?v=1:7:12 ; 256:37 | src/shared/panel-motion.js 22:13 ; agents/main.js 457:50 | PASS offline decode |
| R | M, panel-gap | shared:22 | main.js?v=1:1:146 ; 1:816 | src/shared/panel-motion.js 22:3 ; panel-gap/main.js 40:32 | PASS offline decode (146 -> 22:3 = throw keyword; neighbors 22:3/22:13, same line) |
| R | M, agents | shared:22 | main.js?v=1:1:228 ; 3:5020 | 22:3 ; 3:5020 naive decode = agents/main.js 459:3 (FAIL, wrong method: renderBody, line +2); byte-corrected: 457:50 | PASS only with byte->UTF-16 conversion; naive spec snippet FAIL. Line 3 has 6 non-ASCII chars (an em dash and 5 middle dots) before the call, 7 extra bytes |
| E | any | | not run | | BLOCKED (needs an isolated Herdr window; not allowed) |
| L/R | native Herdr resolution to source in U or M | | all frames are generated-file coordinates; Herdr ignores sourceMappingURL (earlier measurement + every frame here) | | FAIL for "Herdr directly locates source" under both U and M; offline decode needed |

Truth listing for L: fixtures/truth-L.txt (nl -ba). Both R shared-source decodes from both mods land on the same shared file, src/shared/panel-motion.js:22. In the A scheme the two published copies report panel-motion.js:23 in each mod (a copy, not shared/).
Not run: negative controls (remove .map, 7 blank lines, wrong-map swap), source-tree-removed decode, M+inline map, F. Hash triplet logging for those was not done.

## 7. replay.sh
`/Users/tonyyang/git/herdr-my-orca.worktrees/orca-ui-package-plan/artifacts/orca-bundler/20261123T160756Z/replay.sh [outdir]` from the repo (git archive c713c70, npm ci from the saved lockfile, builds U and M twice and compares, builds the L and R fixtures, runs check on scratch copies with scratch HOME, prints decode command). It was executed once: logs/90-replay-run.log; reproduced the same frames and the same M hash. Decode one frame: `node decode-bytecol.mjs <chk>/main.js <bXX>/dist/mods/<m>/main.js.map <line> <col>`.

## 我實際看到什麼
`vp pack` (vite-plus 1.7.0, tsdown 0.23.4, rolldown 1.2.19) 對兩個 mod 都能建出可通過 `herdr-app check` 的 ESM main.js，三個 host 模組保持 external，panel-motion 被內嵌進每個 bundle（仍是每個 mod 一份）。runtime JS 由 35,680 降到 U 19,824 (-44.4%) 與 M 14,232 (-60.1%)，但 A->U 大部分來自刪除註解；外部 map 另有約 56 KB，發布樹總量反而由 39,341 增到約 75-79 KB。兩次乾淨建置的所有檔案 byte 完全相同。Herdr 回報的 stack 一律是產物座標（忽略 sourceMappingURL）；用 node SourceMap 離線解碼後，L 與 R 在 U 和 M 都能回到正確的 src 檔與行，兩個 mod 的 R 都回到同一份 src/shared/panel-motion.js:22。A 方案下 R 能到 render，並指向 mod 內複製檔 panel-motion.js:23（shared 的第 22 行加檔頭 1 行）。
## 哪個觀察可能改變選型
Herdr 的欄位是 UTF-8 byte offset 且約有 +-1 誤差，而規格的 Node 片段按 UTF-16 解碼：agents 的 M bundle 實測有一格 frame 被套用規格片段解到錯的方法（459:3，真值 457），需要 byte 轉換才對。這代表「離線解碼」流程必須包含這個轉換，否則壓縮 JS 在含非 ASCII 的長行上會誤判。另外 Herdr 無原生還原，所以若要求「Herdr 直接定位原始碼」，U 和 M 都不達標；U 的產物行號仍可人工對照但不等於原始碼。體積節省有一大半是註解被刪，不是 bundling 本身。
## 仍無法回答什麼
未在隔離視窗驗證 UI 文字／圖示／操作與 E（點擊）探針；未驗證 Herdr 是否會在執行時讀 .map、載入時間、獨立載入（移除另一 mod）、移除或錯配 map 的負對照、M+inline map、vp build (F)；只測兩個 mod，未涵蓋大型 mod 的加權結果；Herdr core 版本未取得；healthy check 六次是用真實 HOME 跑的，未檢查是否影響 ~/.config/herdr-app。
