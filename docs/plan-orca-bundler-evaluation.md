# 用 Vite+ 打包 Orca mods：執行計畫與觀察報告規格

交給執行模型：請跑完下列實驗並交回**觀察報告與可重跑的證據**。這是獨立技術試驗。決策者要知道三件事：Herdr 實際要讀多少 JS、發生錯誤時開發者能否直接找到可編輯的原始碼，以及 Vite+ 能省下哪些手動維護工作。Vite+ 是唯一評估的打包工具，現行原樣複製提供量測基準。打包成功只完成第一道檢查。

## 0. 先跑一票否決測試（約 5 分鐘）

完整矩陣之前，先確認目前的 Herdr 會不會讀 source map。在暫存目錄做一個最小 mod：`main.js` 第 5 行單獨 `throw new Error("ORCA_PROBE_KILL")`，結尾加 `//# sourceMappingURL=main.js.map`；`main.js.map` 的 `mappings` 設為 `";;;;AAyCA"`，把第 5 行對到 `src/orig.js` 第 42 行。用暫存 HOME 跑 `herdr-app check <資料夾>`，再把 map 改成 inline `data:` URI 重跑一次。

- 兩次都只報 `main.js?v=1:5:<欄>`：Herdr 不讀 map，壓縮版無法原生定位（第 6 節第 2 項不會通過）。直接在報告寫「保留現行複製」並附這兩次輸出，第 2 到 4 節只在專案擁有者要求時才跑。
- 任一次報出 `src/orig.js:42`：Herdr 已支援 map，照第 1 到 6 節跑完整評估。

實測紀錄：herdr-app 0.1.17、hc 0.1.22 兩次都只報產物座標（`artifacts/orca-bundler/20261123T162528Z-retest/map-ext/`、`map-inline/`）。Herdr 升版後先重跑本節。

## 1. 固定輸入與交件位置

- 從此 repo 根目錄執行。固定程式版本為 `c713c7071eb0b43c5b77c9e13d29dd1dd2d983f3`，以 `git archive` 匯出到新建的暫存目錄。此版本代表正在審查的切片，樣本路徑與 rebase 前的 `e66135b` 內容相同；後者只留在備份分支，不再使用。實驗採用自己的 source 目錄、依賴、lockfile、建置輸出、測試 HOME 與 app home。所有工具安裝在實驗目錄，使用明確版本與本地 CLI。
- 在 repo 建立新的 `artifacts/orca-bundler/<run-id>/` 交件，run-id 用 UTC 日期時間。保存 `observations.md`、原始紀錄、設定、lockfile、fixture 差異及 `replay.sh`。重跑腳本從固定 Git 提交重建實驗，且可單獨重跑指定候選與探針。勿提交、推送或改動正式程式、主計畫或 live 設定。
- 每步記錄工作目錄、命令、退出碼、stdout、stderr。版本記錄包括 OS／架構、Node、套件管理器、Herdr App／core、Vite+ 及該命令實際使用的打包引擎。分開記錄 CLI 和專案依賴的版本。保存與實驗有關的環境設定即可。

```sh
repo=$(git rev-parse --show-toplevel)
rev=c713c7071eb0b43c5b77c9e13d29dd1dd2d983f3
lab=$(mktemp -d)
run_id=$(date -u +%Y%m%dT%H%M%SZ)
report="$repo/artifacts/orca-bundler/$run_id"
mkdir -p "$lab/baseline" "$report/logs"
git -C "$repo" archive --format=tar -o "$lab/base.tar" "$rev" &&
  tar -xf "$lab/base.tar" -C "$lab/baseline"
```

**隔離先驗證。** 離線建置與算大小可直接進行。跑 Herdr 前，使用專用測試帳號／VM，或已證實隔離 HOME、core、視窗與子程序的測試環境。測試帳號沒有真實 agent 憑證或 session。Agents 面板會呼叫 `exec`，將 `OMP_CODING_AGENT_DIR`、`PI_CODING_AGENT_DIR` 指到空目錄，從該實例的子程序驗證實際讀到的值。只掛本實驗的兩個 mod，不帶入正式 Orca layout、Tasks 或狀態列。在發出視窗指令前，保存測試 core 的獨立身分與 `herdr-app status` 所示測試 layout 的證據；只有另一個 `HERDR_APP_HOME` 不足以確認 core 隔離。無法證實時，將受影響的 Herdr 測項填 `BLOCKED`，繼續完成離線項目。不要操作使用者正在用的視窗或終端機。

## 2. 固定兩個 mod，先測 Vite+ 的 library 打包流程

取 `mods/orca-panel-gap/` 和 `mods/orca-agents/`。前者能用 `Ports` 文字和 `plug.svg` 確認畫面，後者含較大的 JS 入口。兩者各自 import 一份 `panel-motion.js`，且一併使用三個 host 模組 `herdr`、`gpui-kit`、`gpui-base`。mod 只能 import 自己資料夾，所以打包後每個 mod 仍各帶一份共用程式，跨 mod 去重不在評估範圍；這組樣本用來確認每個 bundle 能獨立載入。

| ID | 要執行的設定 | 要回答的問題 |
|---|---|---|
| A | 以原始位元組複製兩個 mod，保留檔名與目錄。 | 今天的 runtime JS、畫面及錯誤回報是什麼？ |
| P（必測） | 在實驗目錄安裝鎖版的 Vite+，用本地 `vp pack` 為每個 mod 各建一份 ESM。 | 相對 A，實際發布的 JS 縮小多少？Herdr 報錯能否直接指回來源？ |
| F（條件補測） | 同一套 Vite+ 的 `vp build`，沿用 P 的入口、ESM target、externals、壓縮選項與 map 格式。 | 換用 Vite+ 內的另一條建置路徑，能否解決 P 已重現的特定問題？ |

**何時啟動 F。** 預設只跑 A 和 P。若 P 無法產生符合 Herdr 要求的獨立入口，或 P 的壓縮設定無法同時縮小 JS 並通過原始碼定位，先記下具體失敗與證據。只有能指出 F 的哪項輸出或 map 設定可能改變結果時，才用 F 重跑該失敗案例。修得好才補齊第 3、4 節，列為可採用設定。若缺的是測試視窗或 core 隔離，記 `BLOCKED`，保留現有證據。P 已達標時，在報告寫「P 達標，F 未觸發」即可。[Vite+ Pack](https://www.viteplus.dev/guide/pack) · [Vite+ Build](https://www.viteplus.dev/guide/build)

**同一份來源餵給各候選。** 從固定提交複製兩份 `main.js` 到 `src/features/{panel-gap,agents}/main.js`；共用原件放 `src/shared/panel-motion.js`。Vite+ 將兩個入口的相對 import 指向這份原件。A 使用本地相對 import，並依 [既有規則](../scripts/sync-shared.mjs) 在每個 helper 副本加原有的一行檔頭。先證明健康版 A 的四個 runtime JS 與 Git blob 逐位元組相同。這份來源對應也適用於後續的故障版。

**各候選的交付格式相同。** 每個 mod 在自己的 `mods/<name>/` 內提供 `mod.json`、ESM `main.js` 與原路徑靜態資產。將三個 host 模組標為 external，保留由 Herdr 提供的 import；其他 JS 依賴全部落在所屬 mod 之內。先各自建置，再組裝輸出樹，避免第二次建置清掉前一個 mod。合法授權標記及需隨附的 notice 要保留並計入總量。測試檔留在測試目錄，基準與所有受測設定採相同規則。把 `mods/orca-new-menu/freebuff.png` 與 `mods/orca-status/claude-statusline.sh` 另做靜態檔對照，驗 SHA-256 及後者執行位元；兩檔不放入樣本大小的分母，也不執行腳本。

## 3. 先跑健康版，再量大小

1. A 建一次並直接核對 Git blob。P 建 **U**（未壓縮、外部 map）與 **M**（壓縮、外部 map 且保留連結註解）。固定 ESM 格式、target、輸入、資產及授權處理。每個進入完整驗收的 Vite+ 設定從兩個乾淨根目錄各建一次，保存每個輸出檔的相對路徑、bytes、SHA-256、執行位元。若不同，查明是絕對路徑、map 或 JS 本身所致，留下兩次清單。
2. **只量健康、無探針的發布樹。** 用檔案實際長度逐 mod 表列 runtime JS（入口加所有 JS chunks／helpers）、外部 maps、靜態資產／manifest／notice、發布總 bytes。inline map 已含在 JS 內，不能重複計算。兩個 mod 內各自存在的副本算兩次。排除 test、node_modules、工具 cache 和 Herdr check 新增的檔案。A 的兩個 mod 合計應為 **35,680 runtime JS bytes**；對不上先修計量方式。若另測 gzip，放附欄；Herdr 本地讀取量以未經傳輸壓縮的 bytes 回答。
3. 計算每個 mod 和加權合計的節省率 `(A_JS − candidate_JS) / A_JS × 100%`；另列總發布量相對 A 增減的 bytes。比較 A→U 和 U→M，分辨改變檔案結構與開啟 minifier 的影響。用健康版輸出做後續正常載入測試，另複製一份供 `check` 使用。大小減少不等於啟動速度提升。
4. 對每組、每個 mod 跑 `herdr-app check <完整 mod 路徑>`，保留退出碼和輸出。同時檢查輸出 import 與資產能獨立解析。從健康 M 移走另一個 mod 的 JS，留下受檢 mod 的原始資產，重跑載入；交換角色重做。若另一個 mod 一移走就失敗，找出跨目錄引用。
5. 在隔離視窗用最小測試 layout 明確掛兩個入口，給 PanelGap 的 `content.props.tab` 傳 `ports`。依 A 建立正常畫面對照：記錄 Ports 文字與插頭圖示、Agents 的 Search sessions 輸入框，在空 session 下輸入一個查詢並清除。對每個候選的 M 重做，保存 `status` 與實際看過的 `shot`，記下文字、圖示、操作是否一致。每輪先驗本輪 layout 身分，使用乾淨啟動或獨立實例排除舊模組；壞掉的熱重載可能繼續畫上一版。U 如因 M 故障成為備選，也須通過這一輪。

## 4. 重點實驗：從 Herdr 的錯誤回到原始碼

**先製作答案，再看錯誤。** 從健康版另開三份 fixture，每份只注入一個錯誤並適用所有工具。把實際修改存成 patch，用 `nl -ba` 記錄原始相對路徑、符號、行、當行文字，存入 `truth.tsv`。錯誤訊息僅含下面的代號，不得塞入正確路徑或行號。先以唯一 token 核對這次觸發的真是新產物。每個 probe 結束重建健康版，驗 token 消失。

| 探針 | 在哪裡插入、如何觸發 | 要從哪個介面取證 |
|---|---|---|
| L（載入） | 在 PanelGap 入口的 imports 之後、class 宣告之前，單獨一行 `throw new Error("ORCA_PROBE_L")`。這是可正常打包的 JS。 | 保存 builder 成功的紀錄，分別從 `herdr-app check` 和隔離視窗 `status`／錯誤畫面抓到載入錯誤。 |
| R（render／共用來源） | 在 `src/shared/panel-motion.js` 的 `panelFrame(inner)` 第一行丟出 `ORCA_PROBE_R`。A 走正常複製規則。分別只掛 PanelGap、只掛 Agents，各觸發一次。 | 兩個 mod 的 check 與實際 render 都要取證。檢驗兩個發布位置能否指回**同一份**可編輯 helper 的正確行，含 A 的檔頭偏移。 |
| E（視窗事件） | 實驗用 PanelGap 的 Ports 標題加 `.on_click(() => { … })`，在 callback 內單獨一行丟出 `ORCA_PROBE_E`。探針只在點擊時觸發。 | check 和初次 render 應正常；在隔離視窗實際點擊，再收 `status`、畫面與可取得的 host 錯誤紀錄。若只在其中一個介面看到，分欄記錄。 |

必要順序為 A → P-M。F 若觸發，先執行第 2 節指定的單一失敗案例。A 的錯誤若只指向 Git 原有的 mod 檔，也要記下：它對今天直接改 mod 的人有用；移到單一來源後，仍須另驗能否指回 `src/features/…` 或 `src/shared/…`。若正常載入已失敗，該列填 `BLOCKED` 並連回失敗紀錄。對健康可載入但定位失敗的 M，依下列順序排查，每次只改一個條件。

1. **原生診斷。** 保存 Herdr 原始訊息／stack／截圖，逐幀抄下 path、line、column。逐項與 `truth.tsv` 比對。允許把絕對路徑正規化為 repo 相對路徑；產物 `mods/…/main.js:1`、相同 basename、字串 token、或內含 `sourcesContent` 都不能單獨證明 Herdr 已定位原始碼。區分「精確符號所在的原始檔與行」、「只有原始檔」、「只有產物座標」和「沒有座標」。行差一行也要報告。column 有值時要落在該故障運算式，保存工具行列編號基準。
2. **驗證 map 本身。** 記錄產物最後的 `sourceMappingURL`、map 的 `sources`、`sourceRoot`、是否有 `sourcesContent` 以及 JS/map 成對雜湊。在不同目錄安裝發布樹，讓原打包用的來源樹暫時不可存取，再觸發同一錯誤。檢查報出的路徑能否回到固定提交加 fixture patch 的可編輯檔。若 host 僅回傳生成座標，用鎖版的 source-map reader（例如 `@jridgewell/trace-mapping`）對**那組真實座標**獨立解碼。若只有壓縮後的行而缺欄，且該行涵蓋多個原始位置，填「有歧義」。不得搜尋 token 反推出欄位後宣稱可定位。
3. **有外部 map 的 Vite+ 產物再做負對照。** 在獨立副本移除外部 `.map`，冷載入並記下 Herdr 回報有何變化。再在 R 的原始 throw 前加七個空行，重新打包；確認原始行號移動七行。純空行可能讓新舊壓縮 JS 完全相同，因此每次建置都在實驗紀錄保存「來源 patch hash、JS hash、map hash」三者。刻意換回舊 map 時，對照本次紀錄應抓出錯配。若換回正確 map 仍指向舊行或另一個 mod，記 `FAIL` 並保存反例。負對照不納入正式大小或正常輸出。
4. **有條件的補測。** 若 M＋外部 map 只在離線工具定位成功，測同一工具 **M＋inline map**，再測既有 **U＋外部 map**。先跑失敗探針；若恢復，對該設定補完所有必要探針、健康畫面、重建與實際大小。三種仍失敗便停止調參。Herdr 自動還原、離線可精確還原、只能看產物三種結果各自保留。Node 的堆疊或 bundler 自己的語法錯誤，不能代替 Herdr 證據。

外部 map 的離線核對也可直接使用 Node。Herdr 報出的行、欄從 1 開始，但**欄是 UTF-8 byte 位置**，source map 用的是 UTF-16 欄，必須先換算；不換算時，含非 ASCII 的長行（例如壓縮後的單行 bundle）會解到錯誤位置（`orca-agents` 壓縮版實測解成 459 行，真值 457）。回報欄指向出錯的詞（`new X` 的 X、被呼叫的函式名），不是 `throw`；先用已知座標的小樣本校正。用實際數字取代 `LINE` 和 `COLUMN`，並將執行命令及輸出附在證據中。這段只用於外部 map 且同一 JS 只有一張 map 的案例。

```sh
node --input-type=module - "$JS_FILE" "$MAP_FILE" "$LINE" "$COLUMN" <<'JS'
import { readFileSync } from 'node:fs';
import { SourceMap } from 'node:module';
const [js, file, line, column] = process.argv.slice(2);
// Herdr column = 1-based UTF-8 byte offset; SourceMap wants a 0-based UTF-16 column.
const text = readFileSync(js, 'utf8').split('\n')[Number(line) - 1];
const col16 = Buffer.from(text, 'utf8').subarray(0, Number(column) - 1).toString('utf8').length;
const map = new SourceMap(JSON.parse(readFileSync(file, 'utf8')));
const hit = map.findEntry(Number(line) - 1, col16);
if (!hit.originalSource) throw new Error('No original position for this frame');
console.log(hit.originalSource, hit.originalLine + 1, hit.originalColumn + 1);
JS
```

## 5. 執行者必交的報告

將以下四部分寫入 `observations.md`。用 `PASS / FAIL / BLOCKED / N/A`；`N/A` 只用於本來就不應觸發的組合，例如 E 的 check 不應產生事件錯誤。每個結論要連到本次執行的檔案。受阻也必須交報告，列出最後成功步驟、實際錯誤、已嘗試的處理與缺哪份證據。健康案例與故障案例分開計分。

| 表 | 每列單位 | 必填欄位 |
|---|---|---|
| 建置成本與大小 | 工具 × U/M/map 模式 × mod，另加合計 | 原始 JS bytes、產物 JS bytes、map bytes、其他 bytes、發布總 bytes、相對 A 節省率、兩次產物是否一致、版本與檔案清單連結 |
| Herdr 相容性 | 工具／設定 × mod | check 退出碼、外部與本地 import、獨立載入、UI 文字／圖示／操作、隔離實例身分、status／shot 證據 |
| 錯誤定位 | 工具／設定 × L/R/E × mod × 介面 | token、預期 source:line、Herdr 原始 frame（含欄）、原生是否精確、離線解碼結果、移走來源樹及移除／錯配 map 的結果、log 路徑 |
| 觀察與交接 | 每候選一列 | 產物配置方式、相較 A 新增哪些設定與依賴、共用程式如何發到兩個 mod、碰到的第一個問題、可重跑命令、仍未知或只適用此版本之處 |

最後寫三小段：「我實際看到什麼」、「哪個觀察可能改變選型」、「仍無法回答什麼」。特別回答 **是否縮小發布 JS** 與 **是否減少 AI 要手動維護的 JS／輸出對應**。分別引用 bytes 和來源 import／客製設定的證據。附健康候選至少一個完整重建命令，以及由原始錯誤紀錄重做定位的一個命令；若 Herdr 沒有提供座標，附重現該限制的命令。

## 6. 決策者如何使用結果

1. **先守住可用性。** 候選須能獨立載入、保留行為與靜態資產、重建可解釋。若健康 A 已失敗，先修試驗環境或標記基準限制。缺證據的項目保留為未知。
2. **原始碼診斷優先於體積。** 若要預設發布壓縮 JS，L、R、E 必須在適用的真實 Herdr 介面直接定位到正確的可編輯檔案與行。兩個 R 消費端都要通過。如果只靠外部工具解碼，單列為「需要額外診斷步驟」的備案；是否接受由專案擁有者決定。若 A 與受測的 Vite+ 設定都無法直接定位，記錄該版 Herdr 的實測限制，維持現行發布方式並保留探針。
3. **同時交代節省與代價。** 對通過前兩項的設定，比較原始 JS 的絕對與百分比節省、帶 map 的發布總量、必須維護的建置設定。若 inline map 才能定位，採用 inline 後的實際 JS 大小作判斷。兩個 mod 的結果只支持這個切片；若建議全案採用，下一次先擴到大型 mod 再核對加權總量及診斷。
4. **回答是否採用 Vite+。** 報告的結論選「建議本切片採用 `vp pack`」、「建議本切片採用已補測的 `vp build`」、「保留現行複製」或「證據不足」。列出相對 A 的實際 JS bytes 增減、三種 Herdr 錯誤的原生定位結果，以及 AI 少維護或多維護的檔案／規則。Vite+ 其他能力若在本次重建或驗證中實際用到，附命令和觀察到的效益；未使用的功能不計入選型收益。執行者交證據，決策者據此更新主計畫。
