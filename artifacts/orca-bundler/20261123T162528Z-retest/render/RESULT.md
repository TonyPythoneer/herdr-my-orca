# RESULT: 重測 render-time throw 的 check 輸出與行號偏移

Verdict: **CONFIRMED**

## 版本
- herdr-app 0.1.17 / hc 0.1.22 (見 00-versions.txt)

## 健康檢查
- orca-panel-gap 副本: exit 0, "check passed" (10-healthy-gap.out)
- orca-agents 副本: exit 0, "check passed"，附 WARN (mod exec'd `sh`; stranded timers) (41-healthy-agents.out)

## 探針 (scratch 副本，於 panel-motion.js 第 23 行插入 `throw new Error("ORCA_PROBE_R");`)
插入點: 副本的 `export function panelFrame(inner) {` 在第 22 行，throw 插在其後成為第 23 行。
對應 shared/panel-motion.js: 原第 22 行 (`if (props()?.overlay) return inner;`) 在副本中為第 23 行。
即: 副本行號 = shared 行號 + 1 (第 1 行為 header)。 (見 31-line-mapping.txt)

### orca-panel-gap
- exit code: **1** (30-probe-gap.exit)
- stack:
```
ORCA_PROBE_R
    at panelFrame (/private/tmp/claude-501/rt-NLl4/mods/orca-panel-gap/panel-motion.js?v=1:23:13)
    at render (/private/tmp/claude-501/rt-NLl4/mods/orca-panel-gap/main.js?v=1:40:37)

check failed: /private/tmp/claude-501/rt-NLl4/mods/orca-panel-gap
```
- 真實行號 (副本): throw 在第 23 行 -> 回報 23 (一致)。panel-motion 偏移 +1 vs shared/。
- main.js: 未改動，第 40 行即 `render() { return panelFrame(this.renderBody()); }`，回報 40 (一致)。

### orca-agents
- exit code: **1** (43-probe-agents.exit)
- stack:
```
ORCA_PROBE_R
    at panelFrame (/private/tmp/claude-501/rt-NLl4/mods/orca-agents/panel-motion.js?v=1:23:13)
    at render (/private/tmp/claude-501/rt-NLl4/mods/orca-agents/main.js?v=1:457:50)

check failed: /private/tmp/claude-501/rt-NLl4/mods/orca-agents
```
- panel-motion: 真實 23 -> 回報 23，同樣 +1 vs shared/ (副本有 header)。
- main.js: 未改動，第 457 行為 render，回報行號 457 一致；欄位 50 未逐字核對 (V8 欄位與原始碼欄位不必然相同)。

## 結論
- 兩個 mod 都是 exit 1，且各有 2 frame: panelFrame (panel-motion.js:23:13) 與 render (main.js)。
- 行號偏移 +1 成立: 副本 header 一行，回報行號 = 副本真實行號 = shared/ 行號 + 1。
- 注意: 回報的是副本行號；直接拿來對 shared/panel-motion.js 會差一行 (shared 第 23 行是 `const open = ...`)。

## 未做 / 限制
- 未執行 smoke/status/shot/do/ls，未開視窗；僅 check。
- 未核對欄位 (13 與 50) 的 V8 規則；本測試只判定行號。
- 探針只改了 scratch 副本；repo 追蹤檔未改 (50-repo-untouched-check.txt, git status 為空)。
- 命令與 exit code 紀錄見 99-commands.log。
