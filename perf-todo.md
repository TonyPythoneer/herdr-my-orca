# Perf 工作清單：先證明瓶頸，再做最小修正

這套 UI 的成本分成資料投影、JS 元件建立、JS/native 橋接、原生 layout/paint，以及背景
Git／網路工作。只量 `render()` 或 constructor 數量，會漏掉另外幾層，也會漏掉從按下按鍵
到畫面更新的等待。

**目前不能宣稱整體 UI 已變快。下一步先完成 M0 的量測與 fixture 校正，再按量測結果選一
個假設修正。不要繼續自動延伸 virtualization。**

本次任務已覆蓋舊的 20 段累加式 todo。保留的舊文與歷史證據保留於下方；完整舊文可從
Git 讀取（`perf-handoff.md`、`git show HEAD:perf-todo.md`）。

## 接收者分工

| 角色 | 負責 |
| --- | --- |
| 量測者 | M0：來源與 fixture 對齊、事件分層、多情境測試、A/A 噪音門檻 |
| 實作者 | 已分配的 H 編號；先寫能否證假設的測試，再做 patch |
| 驗收者 | 完成條件、結果檔 `perf-evidence/<run-id>/result.md`、保留／回退決策 |
| Solar（本輪） | M0a/M0b/M0c 靜態分析、fixture 校正、交接文件與結果記錄，不改 production |

所有 H 都是待驗證假設。已知程式結構不等於已證實效能根因；任何「已改善」的結論都必須
來自可重現的 A/B 證據，不能來自結構推論、舊數據或被儀器扰动的 log。

## 入口與來源

- 工作目錄：
  `/Users/tonyyang/git/herdr-my-orca.worktrees/perf-todo`；分支 `perf-todo`。
- 分析基準 HEAD：`74d89aef047807c043bace277ee2bdb1cc18dd35`。
- 本輪修改（本次交接產物，未提交）：
  - `perf-todo.md`（本文件）
  - `perf-handoff.md`（保留，不刪）
  - `scripts/perf-spaces-virtual.py`
  - `scripts/perf-spaces-virtual.test.js`
- 保留但不清理：
  - `mods/orca-spaces/gpui-kit.d.ts`（產生檔，勿手改；改版後由 gpui-shell 重建）
  - `mods/orca-spaces/jsconfig.json`（保留，不清理）
  - 所有 `mods/orca-spaces/*.test.js`（回歸門檻，不動他們對現有產品路徑的 asserts）
- 歷史指令不沿用：舊 `main.js` SHA-256 與 virtual builder SHA-256 已過期，不能貼進
  新成績。新的來源身份必須是本輪生成的 manifest，不能只寫 HEAD。

## 保留的成果與未完成項

| 項目 | 目前能說的話 | 不能延伸的結論 |
| --- | --- | --- |
| 單次 grouping／tab pane lookup | 已有 `worktree-plan` 線性分組與回歸測試 | 不能由 Node microbench 推論 UI FPS |
| Production retained rows | 舊 fixture script 顯示 median 35 ms → 8 ms；explicit factories 7,604 → 4 | 不是完整 frame、冷啟動或當前版本的成績 |
| Git 失敗保存 catalog | 失敗時保留已知離線／未開啟專案 | 沒有硬性容量上限 |
| Review cache | active/fresh 保護，200 是 soft target | 不是真正 LRU 或 hard cap |
| Collapsed agent summary | 不建立隱藏 agent 元件，固定數量 summary records | 掃描與簽章仍會隨 agent 數成長 |
| Candidate virtualization | VM 測試涵蓋 queue、typed key、focus、adoption | 不是正式版，也不是 native 操作驗收 |
| 舊 74 tests 紀錄 | 舊文記錄通過 | 本次沒有重跑；未提交的 builder 變動不能沿用 |
| Native frames/counts | 舊兩張零值同圖已撤回；未取得可信完整 trace | 不可說已達全模式 O(1) 或原生 frame 改善 |

保留 `perf-evidence/2026-11-16/measurements.json`、baseline/final logs 及
entity-list-probe 證據；不要再把歷史敘事追加進本文。每個新任務只有一份短結果記錄。

## 程式成本地圖（2026-11-16, production 本體）

```text
250ms checkNew → due + settleRows → ordered → projectWorktreePlan
                         └ review scheduling / host shared writes
UI event → notify → refreshRetained → 全列 rowSignature → syncRetained → notify
render → ordered（再做一次）→ colors/projectKeys/savedRows
       → grouped → agentsByRow + descriptor signature → 每列 retainedRow
       → 穩定 mouse: Entity；cold/changed/keyboard: rowElements
Entity render → header/card → focus helpers / agent rows → native layout/paint
Git refresh → 並行 check → 整份 catalog stringify/persist → notify
```

Candidate 由兩個 Python builder 改寫 production，不是獨立維護的正式 mod：

```text
250ms projectVirtualRows → ordered + catalog/avatar/colors + descriptors + 全列 maps/sizes
                       → queue 全列 → prepare <=16 signatures → sync <=16 native ops → notify
UI event → refresh visible queue → prepare <=16 → sync <=16 → notify
render → prepared rows/sizes → v_virtual_list → visible Entity / placeholders
100ms focus tick → reveal → 等 signature/handle → focus
```

N = projected workspace rows；A = agents；K = git catalog entries；S = saved
folders；V = viewport rows；F = retained focus handles；M = machines。
目前 production 至少有 O(N + A + K) 的重複投影與 O(S×N) 的 saved-folder 比對；鍵盤
header 的 `within → onStop` 在最壞情況可疊成 O(N×F)。Candidate 限制的是部分
signature/native call 次數，**沒有限制整個 callback 的工作量，也沒有把常駐 Entity 限
制在 V。**

## M0a：來源與 fixture 對齊（本輪已做的靜態校正）

- [x] 凍結產品 A 來源與產生檔：
  `mods/orca-spaces/main.js`、`mods/orca-spaces/focus.js`、`scripts/perf-spaces.py` 的
  SHA-256 已寫進 `perf-evidence/2026-11-16/measurements.json`，並與尚未提交的 gang 用
  途 holder 比對；不得只寫 HEAD。
- [x] 列出每個被替換的 API/timer/data source：
  - `scripts/perf-spaces-virtual.py` 把 scroll container 換成 host (overflow_hidden) 並
    接上原有 list ID；virtual list 高度由 root size 減 loading 高度；layout 與注入 Synthetic
    spaces/agents 的 fixture；移除 `checkNew`/machine/saved polling；定時 200 ms probe notify
    最多 150 ticks；100 ms 自動焦點 smoke 會走 `fixture-198`；250 ms 輪詢改成
    `prepareVirtualRows`/`syncRetained` 組合。
  - 這些替換造成 A/B 並非自然等價：自動 focus、100 ms smoke、200 ms notify cadence、fixture
    data 等都是被動態混入的外部輸入。mouse perf case 必須關閉自動焦點；correctness run
    才允許。
- [x] 產生與驗證候選來源：
  `scripts/perf-spaces-virtual.test.js` 透過 Python builder 動態產生 `main.js`，並以
  `vm.runInNewContext` 跑無 Herdr 依賴。`candidate` fixture 內部提前注入 `virtualQueue`、
  `virtualCurrent`、`retainedPending`、`virtualVisible`、`virtualFocusPending`、
  `virtualScroll`/`onStop`/`shared`，所以它驗的是候選演算法，而不是真實 Herdr 元件。
- [x] 為何候選版不能宣稱「現在建議做」：
  候選版的 `projectVirtualRows`、`prepareVirtualRows`、`syncRetained`、`virtualIds`、焦點掃
  描等都建構於未綁定 Herdr lifecycle 的 stub；任何 native 行為（focus ring、Tab 順序、
  drag、variable-height 橋接、組件生命週期）都未在當前版本測過。
- [x] 產出物：
  - `perf-evidence/2026-11-16/measurements.json`（baseline/final 10 samples each）
  - `perf-evidence/2026-11-16/entity-list-probe/*`（legacy probes、logs、PNG）
  - 本文件與 `perf-handoff.md` 作為下一輪重現任務的輸入

## M0b：事件分層（本輪只做靜態分解，產生觀察規格，不輸出完整 trace）

四個階段與對應證據來源：

1. **事件進入**：`spaces()`、`agents()`、`panes()`、`machines()`、`rowSignature` 鎖定的
   `onStop`、鍵盤模式 `t3-focus`。要用取單調時鐘或 `Date.now` 且標明 1 ms 牆鐘粒度。
2. **Projection 完成**：`ordered()` → `projectWorktreePlan`；產生行順、group、fold、descriptor。
3. **Adoption 完成**：`syncRetained` 的 16 操作上限；`candidate` 的
   `prepareVirtualRows` 先捨棄 pending、`virtualVisible` 先備、`virtualFocusPending` 優先。
4. **可見結果確認**：`v_virtual_list` range callback 渲染的 Element；`WorkspaceRow.render`
   只能叫 render-observed，不可以叫 painted。

注記：

- `this.plan = { groups }` 只在 `ordered()` 快照時建立；每一輪不同的 `grouping`、`sortBy`
 、`visibleWorkspaceHostIds`、`filterRepoIds` 都會重新產生 plan。
- `rowSignature` 會在 `refreshRetained()` 時針對全數 `retainedPending` 做 `JSON.stringify`
 ；事件若只改 1 欄，仍須讓所有行重算簽名。把某些欄位丟進 signature 只會把成本移到作者
  認為「不重要」的欄位，禁止輕易刪 signature 欄位。
- 候選版的 `virtualRendered` 標 signature 仍發生在 render 開頭，不是原生 paint ack。
  缺 handle 時的 `reveal/set_props` 重複與超時沒有明確 deadline；`fs.hold` 讓 pending 時
  keyboard mode 並不會釋放。

## M0c：拆 fixture（本輪建議，尚未執行）

P0 是舊的純 folder 200-row 控制組；P1 加真 catalog/saved/projects；P2 多 host、status、
動態 agents；P3 正式 layout 含 tabs/files/changes/terminal。不要把 P0 的改善說成 P3 改善。

| 情境 | 先設 N | 必要紀錄 |
| --- | --- | --- |
| idle 30 秒 | 20/200/2,000 | 事件分層、設定、告警 |
| 冷啟動 | 20 | 冷啟動單列不能藏在 warmup 裡 |
| 單列 hover/unread | 20 | 受影響行數與未受影響行數 |
| project/host fold | 20 | 展開/收合後的可見行數 |
| 連續 scroll | 200 | 每次可見窗口、placeholder 持續率 |
| 正反 Tab | 200 | 明明物理 Tab 的焦點路徑 |
| 同 host drag | 20 | 原目標/目標 key |
| 遠端離線重連 | 20 | machine JSON、relay config |

## 量測規約

1. 每組 A/B 交替三組（AB、BA、AB），相同 warmup 和操作序列；warmup 只排除 steady-state
   統計，冷啟動另報。steady-state 至少 30 秒，互動每類至少 30 次；若要穩定的 tail 結
   論，增加樣本，不要用 10 筆樣本聲稱精確 p95。
2. 使用 runtime 支援的單調時鐘。若只有 `Date.now`，註明 1 ms 粒度／牆鐘限制，不把
   0–1 ms 差異當改善。log 聚合後輸出；另做關閉 instrumentation 對照。
3. 先量 A/A 噪音。預設有效改善需大於噪音範圍，且目標指標改善至少 20% 與 2 ms；這是本計
   畫決策門檻。非目標互動 p95 不得惡化超過 `max(2 ms, 10%)`。
4. 暫定直接可見事件 p95 ≤100 ms；背景 status freshness ≤500 ms；冷啟動單列另報、不能藏
   在 warmup。未達門檻照實記錄，不修改門檻讓結果通過。
5. native trace 若無工具，該欄填 UNMEASURED。先用有 timestamp 的觀察確認事件結果；
   截圖只作可見狀態證據，有 polling 粒度的延遲只能報上界/區間。找量測 API 以一次 20 分鐘
   capability spike 為限，不連續猜 API。
6. 每項最多兩次有明確差異的診斷嘗試；同一錯誤無新資訊則 BLOCKED，交回 error、來源與下
   一個最小問題，不能盲重跑到綠燈。

## H01–H08：優先排除量測偏差與主要熱路徑

### H01 — Fixture 隱藏了真正瓶頸〔高，M0 先做〕

**依據：** `scripts/perf-spaces.py` 把 git 清空、saved 設空、loaded 設 true、換 synthetic
spaces/agents，移除 checkNew/machine/saved polling；但 panes/machines/shared 還可能來自 host。
virtual builder 額外裝 100 ms 自動焦點 smoke 和 250 ms 無條件 notify。A/B 並非自然等價。

**測試：** 列出每個被替換的 API、timer、資料源；P0 固定所有外部輸入，A/B 同 cadence。自動
focus 只放 correctness run，mouse perf run 關閉。再跑 P1/P3；記錄重現症狀是否只在真資料
出現。

**判定／處置：** P0 好但 P1/P3 差即否定 fixture 的代表性；先補 fixture，不改 product。
builder 測試新增「沒有自動 focus／未意外停用目標路徑」斷言。不可只比較 8 ms 和後來的
2–5 ms。

### H02 — root render 以外的工作吞掉收益〔高〕

**依據：** probe 時鐘只包 `Spaces.render`；Entity、task、native layout/paint 在外面。
interval factories 與單次 render factories 也不同。

**測試：** 同 run 分別彙總 root、child、task，按事件 ID 連接；量每秒 CPU 工作量與 event
latency。保持 notify 頻率一樣，禁止把重疊 span 重複相加。callback timer drift 當阻塞線索，
不當 CPU 或 frame 時間。

**判定／處置：** root 降而整體延遲不降，停止 root micro-optimization；轉去實際占比最高的
層。沒有原生證據就只報 JS 層結果。

### H03 — notify 對所有列重算 signature〔高〕

**依據：** `main.js:174` notify → `refreshRetained:213` 全表 stringify，即使只有一列 hover。
signature 含整個 `r.w`、`mine`、theme，並呼叫 review/shared/avatar helpers。

**測試：** N=20/200/2000、A 固定；連續同列 hover/unread，計 signature 次數、序列化字元量、
shared 呼叫與 callback ms。再固定 N、增加單列 A；用不影響畫面的 agent 欄位更新檢查
false invalidation。

**判定／處置：** 事件成本隨 N/A 成長且占主要時間才縮小 invalidation。優先現有 row key 的
dirty set；全域 theme/group/mode 必須仍使相關列失效。測 old/new hovered row、PR title、
unread external writes、theme、merged tabs、reorder；不可直接刪 signature 欄位以換假成績。

### H04 — 250 ms 重複 projection，即使沒有變動〔高〕

**依據：** production checkNew → settleRows → ordered，每 render 再 ordered；candidate 每 tick
全量 projectVirtualRows + notify。projectWorktreePlan 建多份陣列/Map、掃 catalog、排序；
foldedRepos 參數不會在 planner 提早裁掉工作。

**測試：** idle 30 秒及 1 row 每秒變更，數 ordered 呼叫、各來源 revision、分段耗時；分別
增加 N、K、sort 模式，避免把 N 與 K 同時增加。

**判定／處置：** idle 重算為主才重用 projection／按資料變更更新。若 host 每次回新物件，
不能用 reference equality 當變更證據；若 signature 比投影還貴則否決該 memoization。
測 agents/status/title/folder/options/catalog/host 變更均可反映。

### H05 — 有限 native 次數仍有無限掃描成本〔高〕

**依據：** production syncRetained cleanup/adopt 迴圈；candidate 的 retired 探查、
retainedPending FIFO、retainedRows cleanup、prepare prune 仍可能掃全表。16 是操作數，而
不是掃描數或毫秒數；一筆 signature 本身也可能很大。

**測試：** 用真方法而非改寫方法，計 examined entries、native calls、callback duration。
情境：全穩定、只有最後一列更新、前 10,000 列穩定、100 retired + 10 new、持續 visible churn；
定期刷新 snapshot。舊 VM 測試只證明 native calls 上限。

**判定／處置：** 掃描是瓶頸才用 dirty queue／cursor；保持 focus、visible、FIFO、cleanup 都
前進。驗收每類最大 queue age、exactly-once release、沒有 lost update；不以更小 batch 掩
蓋 O(N) scan。

### H06 — 鍵盤模式的 focus handle 掃描與 direct fallback〔高〕

**依據：** production retainedRow 在 shared t3-focus 為真時全部 direct render；
`header → within → onStop` 每次掃 fs.handles 並呼叫 native is_focused。先前 signature
focus snapshot 沒有涵蓋 header 的 within。

**測試：** 固定 N，增加 F=64/320/1000，分 mouse／keyboard；計 onStop/is_focused 呼叫。
正反走過未曾出現的列、超過 pool、從 terminal 進入再離開。不能把 stub onStop=()=>null 的
VM 測試當成本證據。

**判定／處置：** 只在同一 render/event batch 快照 focus，callback 仍讀當下狀態；焦點生
命週期不能共用跨時間的 stale snapshot。需保留 native Tab 順序／focus ring／跨 mod exit；
未通過就維持 production fallback。

### H07 — shared/storage 橋接比 JS 分組更貴〔中高〕

**依據：** stored 仍每次 localStorage.getItem；reviewOf 每列觸發 shared；focus stop 每
control 讀 shared；render colors stringify 整份 shared object。若 host 回傳 clone，
reviewCache 的 reference 比較每列可能都 copy K 個 entries。

**測試：** mock 各 API 同物件 vs fresh clone，計 getItem/shared/copy 次數；native 量 API-only
span，不假定 bridge 成本。改每 batch 一次讀取的實驗版本，保持相同更新輸入。

**判定／處置：** 若每列 clone 導致 O(N×review entries)，在 batch 邊界 snapshot；測另一 mod
invalidate/save、外部 localStorage 寫入、失敗寫入、多 view 狀態不共用 mutable object。
沒有顯著成本就保留現在的 raw-string memo。

### H08 — native variable-size 陣列仍跨橋全量搬運〔高疑慮，需 native 證據〕

**依據：** candidate 每 render 將 `virtualItemSizes` array 傳 v_virtual_list。當地 d.ts 在
21262 附近特別說 uniform number 避免每列跨語言傳輸；同一 JS array reference 不代表 host
不 copy。現有 guarded test 把 v_virtual_list 整個 stub 掉。

**測試：** V 固定、N=200/2000/10000，native-only 對照單一 number vs 等長同值 array；再真
variable array。量 bridge 建構、layout、RSS、render callbacks。number 只用量測對照，
不改變真卡片高度。

**判定／處置：** 若 array 路徑隨 N 成長，strict native O(V) 不成立；先比較現有 native
`list` + Entity 的 bounded spike。其限制是每 visible item 回呼及 handler lifecycle，
不能直接換。若需要 host API，寫明需求／證據交回，不由 Solar 改 host 或硬塞固定高度。

## H09–H17：Candidate 上線前必須驗證

### H09 — 把工作移到 queue 後，互動新鮮度變差〔高〕

**依據：** projectVirtualRows 每 250 ms 才拿新 structural snapshot；event refresh 只重新排
visible 的舊 virtualCurrent，prepare 16，native adoption 有 retired 時最多 8。100 ms focus
tick 又增加等待。

**測試：** 在 tick 前後各注入 fold、group change、rename、agent status、remote repair；
記 input generation → prepared → adopted → render-observed → visual confirmed。
持續 24 visible + 200 background + removal，測最老 queue age；不要只斷言最終完成。

**判定／處置：** 可見直接互動超過 M0 latency gate 就先做 event structural refresh／target
prioritization，而非加快所有 timer。不可挨餓 background／cleanup；變更連續來時 latest
generation 必須勝出。

### H10 — 常駐 Entity 與尺寸／focus map 成長〔高〕

**依據：** candidate 終將為所有 prepared rows 建 Entity；virtualSizes、virtualRendered
沒見移除 row 的清理；focus handles 保留到 mode 結束，prepareQueue 可持有待處理舊資料。
這是虛擬繪製，不是 bounded residence。

**測試：** 100 次 create/scroll/remove，各 200 不同 keys；記 retained/current/pending/queue/
sizes/rendered/fs.handles 計數與 RSS。清空、關閉、重開後重測；分「持續存在的 N 筆」與
「歷史已刪除 keys」。

**判定／處置：** deleted keys map 單調成長即做生命週期清理回歸。RSS 不回落單獨不足以證明
leak，需 live handle/map 證據。Entity window cache 是另一設計，不和清理一起做；必須 pin
pending focus/drag target。

### H11 — row measurement 校正造成跳動、反覆通知〔高〕

**依據：** 初估 64px，on_size_change 寫 map 後 notify，但 sizes array 要下個 projection 才
更新；width 未列入 measurement key。新 viewport/loading 計算是未提交改動。

**測試：** width 220/300/480；單／多 agents，展開後 1,000 agents；頂部／中間／底部 resize、
theme/font scale、loading→ready、快速 fold。記 height changes/tick、anchor key+offset、
scroll_to_item 次數、placeholder 持續時間。

**判定／處置：** 不改資料卻持續高度振盪或 anchor 跳動即失敗。更新 sizes 必須與 projection
generation 同步；量測失效需包含實際會改高度的條件。禁止以固定高度裁切內容通過。

### H12 — Saved Projects 在候選版被漏測／擠出 viewport〔高〕

**依據：** builder 強制 saved=[]；production savedRows 用 S×N contains-prefix 掃描並直接
建全部列。候選外層改 overflow_hidden、virtual list 高度只扣 loading，底下 saved section
沒分配空間。

**測試：** S=0/20/500、N=0/200；包括 missing、unopened、子目錄覆蓋、跨 host 同 path。所有
Saved Projects 必須能 scroll 到並點開／移除；計 saved filter ms／factory 數。用真 saved
輸入執行完整 render，不替換 savedRows。

**判定／處置：** 任何列不可達先修 layout；若 S×N 成本顯著，才建 path lookup，保留 ancestor
語意。此路徑未完成前不能宣稱所有 render input-independent。

### H13 — 手動列出的 focus stops 與實際控制不一致〔高〕

**依據：** candidate virtualIds 另行描述 header/card/PR/host；實際 stop 在 header/card/
prBadge/focus helpers。程式可能新增／移除 control，兩套順序漂移。舊 action-dispatch log
沒證明真 Tab binding priority。

**測試：** 比對實際 stop 註冊 ID 和 virtualIds，涵蓋 PR 有/無、fold、host connected/offline/rebuilt、
group None/Status/Project。真鍵盤正反遍歷至少 80 rows，檢查 terminal Tab、popup、相鄰 mod，
不能只 dispatch_action。

**判定／處置：** 有 trap、跳過、重複、隱形 focus 即禁止 promotion。按實際 control registration
整合，不刪可存取控制來使順序簡單。

### H14 — pending focus 永久等待或聚焦 stale control〔高〕

**依據：** virtualRendered 在 WorkspaceRow.render 開頭標 signature；不是原生 paint ack。
缺 handle 時反覆 reveal/set_props，沒有明確 deadline；fs.hold 讓 pending 時 keyboard mode
不釋放。

**測試：** request 後立刻 remove/filter/fold/group switch/lose window focus；PR 消失、同 key
controls 改變、prepare/adopt failure。檢查不 focus released handle、不回彈、不無限 notify；
每個 request 有 generation／取消原因／完成時間。

**判定／處置：** timeout/cancel 要回到仍有效 stop 或交回鄰近 mod；限制 retry 且保留 latest-wins。
timeout 數值先依 M0 latency 定，不任意延長等待來通過。

### H15 — queue 更新、排序與 callback identity 競態〔中高〕

**依據：** virtualProjected、Current、Pending、Rows、sizes 分開更新；retained data 的
signature 可原地更新；render closure 持舊 rows，而 key 對應 Entity 可已換代。

**測試：** click/drag down 後立刻 sort/filter/remove，再 mouse-up；同一 key 先 old 後 new
update；typed workspace key 與 host/status label collision；分兩 host 重複 status headings。
斷言 target key，不只 index；每 generation 的 array length/key/order 一致。

**判定／處置：** stale 操作要取消或命中原始合法 key，不能打到新 index 的別列；維持 typed
namespace 既有測試，不重寫全部 scheduler。

### H16 — 雙重捲動／scrollbar／拖曳命中範圍錯誤〔高〕

**依據：** 未提交修改把原 scroll container 改 hidden 並讓 virtual list 接原 ID；drag handler
仍在外層，card pos 來自 full plan，不等同 virtual descriptor index。

**測試：** wheel／trackpad、拖 scrollbar 到尾、同 host reorder、cross host rejection、
拖曳中捲動、移出側欄、未開啟/merged row、folded host、sidebar resize。比較實際 `space.move`
參數與視覺目標。

**判定／處置：** 一次只修 scroll ownership 或 reorder mapping。所有 native correctness case
完成再計 perf；不能用 timer 直接呼叫 handler 取代 pointer 命中證據。

### H17 — 一個巨大 expanded card 打破 V-bounded 成本〔高〕

**依據：** collapsed summary 工廠量有界，但 count 用多次 reduce，icons 在原 mine 掃描，
signature JSON.stringify(mine)；expanded 仍 `mine.map(agentRow)`。1 個 visible row 可以含
1,000 個 agents。

**測試：** N=1，A=1/10/1000/10000，分 collapsed/expanded，真 native image/status helpers；量
signature、scan、child build、layout。保留 missing-icon 與 status order 現有回歸。

**判定／處置：** collapsed CPU 高才預計算 summary；expanded 高才評估內部虛擬化，必須保留
全部 agent 可達，不用截斷／預設折疊改功能。暫不承諾對任意 A 全模式 O(1)。

## H18–H26：正式資料與其他面板

### H18 — Git fan-out、watch event storm、status 被慢 refresh 擋住〔高〕

**依據：** refreshGit 對整 batch Promise.all；watch 可加入 pending；checkNew 在 refreshing
時抑制 status notify。單一慢 remote 可拖住完整 pass，重複到來的 key 可能讓 pass 持續。
PR max=2 並不限制 Git process。

**測試：** isolated fake exec 注入 20/200 keys、慢 remote、timeout、連續 watch burst，
計 inflight、重複 commands、pending age、status freshness；真小型 repo 驗證一次。不
要對真 200 repos 發命令。

**判定／處置：** 若 inflight/refresh age 與延遲相關，加入 bounded concurrency／同 key 合併，
維持 per-key latest result／失敗保留完整 catalog；不要等待整批完成才更新無關 agent
status。改動前先寫可控 deferred promise 回歸。

### H19 — catalog 持久化和跨面板讀取成本〔高〕

**依據：** refresh pass JSON.stringify 整份 git；nav projectChoices 與 agents resolveProjectScope
JSON.parse catalog；snapshot 包重複 sibling worktrees。saved 是使用者資料，不是可拋快取。

**測試：** 固定 N=20、K=20/200/2000/10000，工作樹 siblings=1/100；測讀取、parse、stringify
bytes、寫入 duration，切 options/agents panel。測 quota/write failure 和離線 restart
JSON round-trip。

**判定／處置：** 先跳過 unchanged write／memoize parse（含 external invalidation）；不要先
改 schema。硬界限和無限 lossless catalog 不相容；若需要 migration/paging，提交容量證據
與設計給使用者，Solar 不自行刪除／LRU 淘汰專案。

### H20 — Review cache whole-object copy/write 與 TTL churn〔中〕

**依據：** saveReviewCache 會 enumerate/sort/stringify；active/fresh 可超過 200；每 completion
notify。兩份 review-store 要一致；signature 每列讀取此資料。

**測試：** 205 active、2000 fresh/stale 混合，雙 view concurrent completion/invalidation，計
每秒 lookup/write/notify；假時計驗證 positive 60s、negative 15min。與 H07 clone 模式一起
測。

**判定／處置：** 只有佔主要成本才合併無變動寫入／通知；不得改 refresh timestamp 當 access
LRU 或犧牲 TTL。現有 `review-store.test.js` 必須測兩份實檔。

### H21 — Avatar／agent images 冷啟動程序與解碼〔中〕

**依據：** render 掃 Object.values(git) → ensureAvatar；每個新 owner 可 spawn mkdir/test/curl/
convert，無全域 concurrency cap；image native cache/解碼未量。

**測試：** 固定 N/V，owner=1/100；warm image vs cold directory；先 fake exec 計 spawn，然後
小型真離線/連線測試。記 startup CPU、首次可見時間、decode/paint 能觀測的部分，不拿網路
延遲當 JS 算法成本。

**判定／處置：** fan-out 才用可見優先和 bounded download；decode 才查 native caching。保留
錯誤 fallback；不能刪 avatars 來宣稱無視覺變動的優化。

### H22 — 其他 mod 與終端使 sidebar 單獨測量失真〔中高〕

**依據：** production layout 同時有 terminal、tabs、files、changes、agents/status；
native spinner/terminal output 可能持續要求 frame。

**測試：** P3 固定 terminal output rate，依序只替換一個 panel 為靜態占位，保留幾何和其他資料。
對照全部 idle／持續輸出；記每 mod render/task 次數與整窗互動延遲。

**判定／處置：** 若去掉 spaces 無改善，先查有因果差異的 mod；不再投入 sidebar virtualization。
native paint/GPU 是否主因只能由 trace/消融證據推斷，不由 JS log 排除。

### H23 — Agents panel 的 O(A×N) 和 catalog parse〔中〕

**依據：** `orca-agents/main.js:477` project scope 在每 agent filter 內 `sp.find`；render
開頭 resolveProjectScope 讀 catalog；history path scope 也有巢狀比對。

**測試：** workspace/project/all 三 scope，N 和 A 獨立擴大，量 render/filter/parse；測
missing space、same path different host、merged project。實際症狀若不開 Agents panel，降
優先。

**判定／處置：** 主因成立才每 render 一個 Map；沿用 tab-panes 的線性 lookup 思路，不建立
新的全域 framework。

### H24 — Files 已虛擬化，projection／search 輸入仍大〔中〕

**依據：** treeList 每 render flat，最多 5000 entries、depth40；flat 每個遞迴會 filters(root)；
search 顯示 200 不代表 stdout parsing 或 fileList input 只有 200。

**測試：** 500/5000 平面與深樹、fold/unfold、name/content search、快速改 query；量 flatten、
filter storage reads、input bytes、render，檢查 stale search completion。保留 existing
cap 語意。

**判定／處置：** 只優化佔比最大的 projection/parse 階段。不要因 list 已虛擬化便宣稱整個
Files 有界，也不預先新增第二套 virtualizer。

### H25 — Changes 的「1000 上限」實際可出現約 2000 列〔中〕

**依據：** `orca-changes/main.js:142` slice 是 1000 raw status entries；同一 partially staged
path push staged + changes 兩列；兩份 numstat 仍 parse 全 stdout，section 直接 map 建列。

**測試：** 1000 partially staged paths → 2000 row entries、10000-path stdout；量 parser/layout
分開，fold 三區後再量。測 staged/unstaged counts、binary、conflict、bulk actions target
完整性。

**判定／處置：** 明確改正報告中的「1000 rendered rows」說法；若原生列成本才做該 panel
virtual rendering。不能截斷 bulk 操作清單來降低成本。

### H26 — Tabs drag timer 或 history/status probe 干擾〔中低〕

**依據：** tabs 有 16 ms drag/overlay timers；不是一般 idle polling 的證據。agents history
60s、status usage 120s、files/changes 10s 可造成週期尖峰。

**測試：** timer 建立/取消 counter；連續 100 次開關 drag overlay／cancel/close，再 idle，觀察
callback 是否歸零到 baseline。正式 layout 觀測至少跨兩個 120s 週期，將 spike 對上 task
start/end。

**判定／處置：** timer leak 才修對應 close/cancel；正常短命 timer 不改。週期 probe 主因才
去重/排程，禁止先重寫 diff/usage parsers；舊 microbench 沒顯著收益。

## H27–H30：正確性與觀測本身

### H27 — log、強制截圖、active window 狀態造成假結果〔高〕

**測試：** 同資料比較 instrumented/uninstrumented；截圖採 correctness run，perf run 不持續
shot 喚醒視窗。記前景/背景、DPI、refresh rate、viewport、thermal/其他負載；同機 ABBA。
錄影／觀察若改變 cadence，要單獨標。

**否決／處置：** 關閉 log 後效果消失即量測擾動，不合併修正。不能把 inactive 視窗沒 paint
當 scheduler 故障。

### H28 — source、hot reload 與驗證工具版本不一致〔高〕

**依據：** 舊 check 是 0.1.15、runtime 0.1.16；broken save 可能繼續跑舊版。待測腳本還有一
個未提交變動。

**測試：** 同 binary hash，generated main/import hashes，startup run ID；status errors 必須
空且 active mod/layout 正確。check 首次 cold fail 要保存；排除 fixture error 後才談 product。

**否決／處置：** 來源或版本不一致則整組無效，不重解讀舊 log。re-run 只在來源／環境變更時
進行；不得「偶爾通過」當可靠。

### H29 — 壞 storage／異常大欄位讓 callback 失敗〔中〕

**依據：** stored 只驗 object/array 粗 shape，rowSignature stringify 整個 host object；
savedRows 的 `s.folder.startsWith` 沒有完整 null guard；review storage fallback 可能讀
到非預期 shape。

**測試：** 既有 fixture 注入 missing/null folder、超長 title、malformed JSON、wrong
top-level shape、寫入失敗；確認不毀掉 catalog、不 crash loop。只接受 host contract 允許
或 storage 邊界可出現的資料。

**判定／處置：** 不把 correctness crash 當效能退化；分成 bounded validation fix。不要為永遠
不可能的 host shape 建泛用 sanitizer；先查 installed d.ts。

### H30 — close／watch／retained state 沒清乾淨〔中〕

**依據：** close 對全部 retainedRows release；watch 是 async loop；candidate focus timer、
scroll handle、maps、native state 各自有 lifecycle。大量 Entity close 也可能超過 host quit
budget。

**測試：** 反覆 mount/unmount、close 時 pending git/avatar/focus；記 late callback errors、
live task/handle 數與 close time。大量 retained rows 的 close 單獨量，不能只測 200-row
steady state。

**判定／處置：** 需取消的 promise 用已安裝 API 的 cancel，避免 callback 對失效 view notify；
不在未知狀態重複 release。host 是否自動取消 timer 必須實測/讀原始碼，不能憑直覺。

## 可交給其他 Solar 的執行順序

不是 30 個假設全部實作。每一輪按證據挑一個，其他維持 UNTESTED。

| 任務 | 允許修改 | 必交付 | 完成後 |
| --- | --- | --- | --- |
| M0a | evidence 與 fixture manifest | source hashes、A/A、API 替換表 | M0b |
| M0b | probe instrumentation＋對應測試 | root/child/task/event spans、無遞迴 notify | M0c |
| M0c | fixture/test，禁止 production 優化 | P0/P1/P3 初步分層結果 | 選最高占比 H |
| S1 | 一個 H 的測試，最多一組 helper | 修改前可重現、明確 oracle | S2 |
| S2 | 該 H 的最小 production/candidate diff | 修改前失敗、修改後通過，無功能退化 | S3 |
| S3 | 同一 fixture paired A/B | 結果達 M0 gate 或否決 | 保留或只回退自己 diff |
| C1 | candidate correctness tests | H09–H16 全部 native acceptance | 再討論 promotion |
| R1 | changed scope checks | final exact-source regression＋smoke | 寫完成/未完成，不自動部署 |

建議首輪測 H01/H02/H03/H04/H06/H08；H10/H12 是 candidate correctness gate，不能因速度快
而跳過。跨模組 schema、native API、focus lifecycle 架構變更先交回設計，不讓小模型邊試
邊擴 scope。

## 完成條件

- 目標操作有可重現症狀；A/B 來源與環境一致；改善超過噪音且沒有轉移成本／延遲。
- 修改有最小回歸測試；required checks 和對應真 native interactions 在最後來源上通過。
- 不刪專案、不破壞離線 restart、TTL、nested control、Tab／Shift-Tab、拖曳、variable height、
  跨 host 語意。
- production 與 candidate 分開報告。未取得 trace 就保留 UNMEASURED；未達 memory/render
  bound 就保留 OPEN。
- 「總持久資料有硬上限」與「任意多專案無損保存」需另外定義儲存政策；本輪不偷換需求。
- 結果保存於 `perf-evidence/<run-id>/result.md`，更新下表一列；不再加第 21、22…段歷史。

| ID | 狀態 | 來源 hash／證據 | 結論／下一步 |
| --- | --- | --- | --- |
| M0 | 部分完成 | `perf-evidence/2026-11-16-{m0,prod,prod-nolog,native}/result.md` | P0 A/A、AB/BA/AB 與部分 native 操作已量；P1/P3、事件到 paint、遠端操作未完成 |
| H01–H30 | 部分測試 | 上列結果與 `mods/orca-spaces/git-refresh.test.js` | Git 負快取重試問題已修正；其餘假設仍需按需驗證，不代表已確認根因 |
