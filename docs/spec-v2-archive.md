# 歸檔：沙盒時代的審查與中間決定（原 spec-v2-converged.md 的 8.2.1 到 8.2.7）

> 2026-11-16 owner 決定不用沙盒、全信任、完全靠 prompt 保護後，這些內容已被 `spec-v2-converged.md` 的 8.2（最終版）取代。**只供查閱，不作為規格**。其中仍然有效的事實已移到 8.2.6 到 8.2.8。

### 8.2 E2E 安全審查（三位 advisor，2026-11-16；全部唯讀、沒有啟動任何 agent）

審查角度：破壞範圍、Runner 邏輯與競態、規格完整性。引述 advisor 的內容中，凡我沒有自己驗證的，都標「advisor 讀到」。我自己驗證過的：`hc --skill` 明載測試需要專屬 `HC_SESSION` 與暫存 XDG 路徑、kill 不清 detached 程式；`/usr/bin/sandbox-exec` 存在；V34、V35（本檔 6.1）。

#### 8.2.1 風險與處置（按嚴重度）

| # | 風險 | 規格現況 | E2E 前的處置 |
|---|---|---|---|
| 1 | （**已有實測：V38、V39**）worker 繼承你的整個登入環境（SSH agent、各種 API key），全權限，可 `git push`、讀 `~/.ssh`、改 `~/.gitconfig`（advisor 讀到 `env` 有 `SSH_AUTH_SOCK` 等） | E48：擋不住也偵測不到，只靠 D3 的 prompt 禁令 | E2E 用 `sandbox-exec` 包住 dev 的 argv（只允許寫拋棄式 repo、狀態資料夾、opencode 的 `~/.local/share|state`、`~/.cache` 與 `/private/tmp`，網路只開 omlx 的本機連線）。**已實測可行（V38、V39）**，profile 見 V38；前綴要是 `env -u XDG_… sandbox-exec -f <profile>`（V37）。這要求 Runner 能接受「argv 前綴」（新增 `config.json` 的 `dev_argv_prefix`，只在 E2E 設）。**只保護 dev**：Tuning（claude/codex）仍無沙盒，見 8.2.4 |
| 2 | 沒有整體花費、時間、磁碟上限（只有單 task 限制） | D6、D12、D13 | E2E 的 `config.json`：dev／tuning 10 分鐘、測試 2 分鐘、`max_rework_cycles=1`；外層再套 `timeout 2400`；跑前後 `df` |
| 3 | E2E 對 **你真實的 core** 與 App 操作；Runner 的 bug 可能 kill 到你的 terminal（`t1 t14 t25 t26 t4v t51 t5n`） | R-G 只 kill 帶 `orca.run` 標籤的，但那是規格，不是已實作的程式 | **專屬 core**（**已實測 V36**）：短路徑的 `HC_SESSION` + 暫存 XDG（socket 路徑 ≤103 bytes），worker 必須 `env -u XDG_*`（V37）。代價：測不到 AT-03 的真實 App 關 tab，AT-03 另外在 owner 在場時對測試 tab 單獨做 |
| 4 | `close_planning_tab` 在 E2E 被打開（U5 未測） | M4：預設 false | E2E 設定鎖 `false`；不從你的 tab 執行 `/herdr-planning` |
| 5 | model 沒釘死，大 model 可能擠掉你的 omlx 服務 | D2：用 opencode 設定檔預設 | 拋棄式 repo 內 commit `opencode.json = {"model":"omlx/LiquidAI--LFM3-1.7B-MLX-4bit"}`；Tuning model 明確傳 `--model/--effort`，並先告知你會花 claude 額度 |
| 6 | Runner 會執行 AI 寫的 `test`／`verify` 指令，沒有沙盒；`init` 的空測試過濾只擋 `true`、`:` 之類 | M2：user 事前核可 | 你逐行讀過所有 `test`／`verify`；`init` 另掃 `~`、`$HOME`、`..`、`sudo`、`curl`、`rm`、`git push`（命中就拒絕）；Runner 本身也放進 sandbox |
| 7 | worker 殘留程序 | U15 | `nohup &` 已驗會被清掉（V35）；`setsid`／雙重 fork 仍未驗；dispatch 明文禁止；跑後 `ps`、`lsof -iTCP -sTCP:LISTEN` 對基準 |
| 8 | 全域狀態污染：opencode 的共用 `opencode.db`、plugin、`~/.config/herdr-app/my-orca/index.json` | 無 | 跑前後記錄大小與 session 數；跑完把 `<wt-id>` 資料夾搬走、移除 index 項目（advisor：DB 並行行為是猜的） |
| 9 | 秘密進到 `logs/<id>.txt` 或 repo | D15、E43 | 跑後用 `grep -rEn 'sk-|AKIA|ghp_|PRIVATE KEY'` 掃狀態資料夾與 repo |
| 10 | repo 若是真實 repo 的 clone，worker 摸得到真的 remote／hooks | 無 | 用全新 `git init` 在 `/private/tmp/orca-e2e-*`，`git remote -v` 為空，本機 `core.hooksPath=/dev/null`、`core.autocrlf=false` |
| 11 | worker 讀寫 cwd 之外的狀態資料夾可能被 `--auto` 擋 | 未驗 | **已驗 V34**（隱藏資料夾、1.7B、一次）；仍需用真實路徑再驗一次 |
| 12 | 額度中途耗盡留下半個 commit | E44、`--accept-head` | 只會停在 `needs_user`，不是破壞 |

#### 8.2.2 E2E 安全規程

**前置條件（全部成立才開跑）**：①專屬 core 已啟動，`hc ls` 看不到你的 terminal；②拋棄式 repo 已建好（含 `.gitignore`、`opencode.json`、3 個 dev task、1 條故意不過的 acceptance、已紅的測試）；③`config.json` 已設小上限；④U13、U15 的剩餘部分補測完；⑤M6 到 M12 已實作並有單元測試；⑥你已讀過所有 `test`／`verify` 指令；⑦你同意 claude Tuning 花額度的時間點。

**基準（跑前存到暫存資料夾）**：`hc ls --json`、`herdr-app ls`、`ps -axo pid,ppid,command`、`lsof -iTCP -sTCP:LISTEN -nP`、重要檔案的 `shasum`（`~/.gitconfig`、`~/.zshrc`、`~/.ssh/config`、`~/.config/herdr-app/{programs,settings,keys}.json`）、`crontab -l`、`~/Library/LaunchAgents`、`df -h /`、你的真實 repo 的 `for-each-ref` 與 `stash list` 雜湊；`touch marker`。**不要讀 `~/.config/opencode/` 的內容**（含 API key；其中一位 advisor 讀過它，沒有回報金鑰內容）。

**即時監控（每 15 秒）**：新增的 terminal 只能是帶 `orca.run` 標籤的；`hc ls --label orca.role=dev` 至多 1 個；repo 以外沒有寫入；沒有新的監聽埠；總時間超過 40 分鐘。任何一項違反 = 立刻中止。

**中止**：①`hc kill orca-r-<wt>`；②對每個 dev worker 以名稱或標籤 `hc kill`（不用萬用字元，**每個指令之前都過 M13 的 core id 斷言**；address 在專屬 core 與你的 core 之間會撞號）；③`pgrep -fl <repo 路徑>` 後 `kill`；④只停專屬 core，**永遠不對你的 core 執行 `hc server stop`**；⑤稽核完成前不刪狀態資料夾。

**跑後稽核**：`hc ls`／`herdr-app ls` 與基準 diff 為空；沒有 **live** 的 runner／dev／tuning terminal（M12）；`shasum -c` 與真實 repo 雜湊不變；`find ~ -xdev -newer marker` 排除 repo、狀態資料夾、opencode 目錄後為空；`ps`／`lsof` 沒有多餘程序或埠；秘密掃描無命中；`git reflog` 只有 `orca(...)` commit；`events.jsonl` 每筆 `kill` 都帶 `orca.run` 標籤。

#### 8.2.3 E2E 測試計畫

1. **預檢（不花模型額度）**：補測 U13（deny 權限的行為）與 U15 的 `setsid`／雙重 fork；用手動模擬 worker 走一遍 dispatch 範本與 Runner。
2. **拋棄式 repo**：`/private/tmp/orca-e2e-<ts>/`，含 `.gitignore`、`opencode.json`、`tests/t01.sh` 到 `t03.sh`、`tests/all.sh`。T-01 `greet.sh` 印 `hello`；T-02 `add.sh`（deps T-01）；T-03 `upper.sh`（deps T-02）。AC-1 `sh tests/all.sh`；AC-2 `grep -q '^v1$' CHANGELOG.md`（沒有 task 會建立它，強制一輪 rework 產生 `R1-01`）。handoff §9：Tuning 不得直接改檔，要用 rework task。
3. **Planning**：（8.2.9 修正）必須包含**一次真實的 Planning 啟動**：在該拋棄式 repo 目錄開 claude 或 codex、接受信任對話框（V56），再用 `my-orca init --handoff … --tasks …` 呼叫（涵蓋 AT-01、02、U11）。不能直接在沒有被信任的目錄啟動 Tuning。
4. **取樣器**：每 2 秒存 `hc ls --all --json`、`herdr-app ls`、`git log --oneline` 與每個 `orca.*` terminal 的 `hc get`（AT-04、05、06、09 的證據；Tuning terminal 在 review 後會被 rm，所以要邊跑邊存，或把白名單 argv 記進 `launched` 事件）。
5. **通過標準**：3/3 dev task 有 ack 與合法 result；剛好 1 輪 rework；`ready_for_review`；沒有多餘 tab；非 `orca.run` terminal 前後相同；`git stash list` 不變；沒有不在許可清單內的 kill。
6. **失敗分類**：Runner 的轉移與證據矛盾（有效 result、測試過、樹乾淨、`HEAD` 是後代卻被拒絕；出現第二個 worker；kill 了無標籤 terminal；Runner log 有例外）= **Runner bug**。Runner 正確地得到 `undelivered`／`exit_without_result`／`task_failed`，且 `logs/` 顯示模型沒照步驟做 = **模型問題**。1.7B 很可能過不了多步驟的 worker 合約：先把 dispatch 縮成可直接複製的 shell 區塊；再不行，只改 `opencode.json` 換較強的 model、其他完全不動重跑；較強者過關 = 1.7B 是原因。**絕不放寬 Runner 的檢查。**
7. **證據**：`state.json`、`events.jsonl`、`dispatch/`、`results/`、`reviews/`、`logs/`、`git log --stat --graph`、每次 `git status --porcelain --ignored`（測試前、後、kill 後）、測試的 exit code 與耗時、各個時點的 `hc get` 原始輸出、`hc --version`、`opencode --version`、使用的 model、任何出現過的權限或對話框畫面。

**AT 證明上的缺口（advisor 提出）**：AT-14 缺「Tuning 說 pass 但 Runner 重跑 verify 失敗」的 F 測試（加進第 6 步）；AT-16 需要點擊，`shot` 不能點，標 M 或 NOT TESTED；AT-20 需要兩個 worktree，單一 E2E 不涵蓋，用 E7 的 F 測試；AT-11 與 AT-13 要注意 Tuning 可能選「直接修」而不是 rework，要在 handoff 寫明；AT-09 的 `hc get` 證據需邊跑邊存。

**仍待 owner 決定（寫進 3.1 以外的新問題）**
- **Q-E1**：E2E 是否用 `sandbox-exec` 包 dev（需要新增 `dev_argv_prefix`）？建議：要。
- **Q-E2**：E2E 是否用專屬 core？建議：要；AT-03 另做。
- **Q-E3**：Resume 的語意採 M9（新預算、再 2 次嘗試）是否同意？

#### 8.2.4 全部採最佳配置（Q-E1 沙盒、Q-E2 專屬 core、Q-E3 M9）的預測與邊界

**意見來源**：Fable 5.2（medium，唯讀）加上我在本輪實跑的 V36 到 V40。本節的「預測」是推論，不是測試結果。（harness 提示 Fable 的輸出含 `settings.json`、`dangerously-skip-permissions` 字樣，那是它在引用本文與 Tuning 的旗標，沒有夾帶指令。）

**預測結果**
- 時間約 40 到 70 分鐘；claude Tuning 約 2 個中型 session 的額度；opencode 本機免費。
- **最可能失敗的不是 Runner，是 1.7B 的合約遵從**：ack、改檔、跑測試、commit、最後才寫 result，一次要全做對。預期 3/3 拿不到，至少一個 task 進 `task_failed`，歸類為模型問題，照 8.2.3 第 6 步換 model 重跑。
- **第二個失敗點是環境**：V37（XDG 繼承）與 V38（loopback 一定要放行）都是我實測時一開始踩到的，實作時沒寫進 Runner 就會被誤判成 `undelivered`。
- Runner 的邏輯在 fake-agent 階段就該全部通過；E2E 真正多出來的證據只有 AT-10 與「真 opencode 那一半」。

**買到的安全**：dev worker 不能寫 repo 以外的地方（`~/.ssh`、`~/.gitconfig`、其他 worktree 的寫入被 deny）、不能連外網（`git push`、`curl` 都會失敗，V39）；你的 terminal 不在專屬 core 內，Runner 的 bug 殺不到它們（V36）。

**邊界（最佳配置之後仍然沒保護或沒驗證的）**
1. **Tuning（claude／codex）完全沒有沙盒**：全權限、你的憑證、全網路、可 push，只靠 handoff 的禁令。
2. **Runner 自己跑的 `test`／`verify` 沒有沙盒**；規格沒有對應設定（8.2.1 第 6 項「Runner 也放進 sandbox」目前只是想法）。
3. **讀取不受限**：dev 仍可讀你的任何檔案（`~/.ssh`、`~/.codex/auth.json`、opencode 設定檔裡的其他 key），環境變數也沒清。要擋要另加 `deny file-read*` 與 `env -i` 的清單（沒測）。
4. loopback 全開：包含你的 opencode service（`127.0.0.1:49374`）與 omlx（`:8000`，狀態不可重置）。
5. opencode 共用的 `opencode.db`、`opencode serve --service`、pty daemon 仍是全域的；`--standalone` 是否完全不碰 service 只有間接證據。
6. 真正脫離 process group 的 daemon 是否殘留（U15 剩餘部分）。
7. AT-03 的 `tab.close` 沒有證據（U5），要在你在場時另外測，專屬 core 看不到 App。
8. claude／codex 在專屬 core 內是否能啟動、憑證是否可用：**未測**（推論 HOME 不變就沒事）。
9. sandbox-exec 已被 Apple 標記為 deprecated，目前可用，不保證跨 macOS 版本。

**逐題意見**
- **Q-E1（沙盒）**：同意。反方論點：deprecated 工具，調 profile 可能比 E2E 本身花更久。回應：profile 已經調好（V38），只剩寫進 `dev_argv_prefix`。`dev_argv_prefix` 只在 E2E 的 `config.json` 設，README 標「macOS only」。
- **Q-E2（專屬 core）**：同意。反方論點：證明的是「在測試 core 上可行」。回應：差異只有 XDG 與 App 功能，V36、V37 已把它們變成事實。socket 路徑要短。
- **Q-E3（M9）**：Fable 同意但提醒：Resume 給 2 次新嘗試，連按 Resume 就等於無限次。**建議微調**：`attempts[]` 不清零，Resume 只把上限 `max_attempts += 2` 並寫 `resumed` 事件，稽核時看得到總次數。**owner 已同意（2026-11-16）：採這個微調**。

**現在就能跑的收斂階梯（★ 是本輪已完成）**

| # | 內容 | 狀態 |
|---|---|---|
| 1 | 專屬 core 起得來、與你的 core 隔離、停得掉 | ★ V36 |
| 2 | 專屬 core 內 opencode 找得到 omlx model（需 `env -u XDG_*`） | ★ V37、V38 |
| 3 | sandbox 內 opencode 能完成 V34 等級任務 | ★ V38 |
| 4 | sandbox 擋寫入與外網 | ★ V39（opencode 內的 `touch` 無法與「沒執行」區分，已用直接測試補） |
| 5 | U15：脫離 process group 的 daemon | ★ 已完成（V42：會存活，環境標記掃描可清）；原：剩 `setsid` 類（macOS 沒有 `setsid` 指令，需用 python `os.setsid`），可無人值守 |
| 6 | U13：`opencode.json` 對 `rm` 設 deny，看會不會回報 `blocked` | 未做，可無人值守 |
| 7 | 手動扮演 worker 走完 4.9 的 dispatch 範本（5 步），在專屬 core 加 sandbox 內 | ★ 已完成（V43、V44；linked worktree 與真實 `results/` 路徑未涵蓋，見 8.2.6 第 12 項） |
| 8 | claude／codex 在專屬 core 內能否啟動（Tuning 用） | 部分 ★（V45：auth 與 model 檢查）；真 session 啟動併入 E2E 第一次 Tuning，需 owner 授權少量額度 |
| 9 | U5：`tab.close` | 未做，**需 owner 在場** |

**「E2E 可安全開跑」清單**：①專屬 core 的 `hc ls` 為空且 core id 不等於你的（V36）；②（作廢，8.2.7：不用沙盒；改為 R-H 的 push 機制已驗證）；③階梯 5 到 9 完成；④8.2.2 的基準已存；⑤`config.json` 小上限、`close_planning_tab=false`；⑥M6 到 M12 已實作並有單元測試；⑦你已讀過所有 `test`／`verify`；⑧你同意 Tuning 花額度的時間點。

#### 8.2.5 owner 的決定與其含意（2026-11-16）

**Q-E1、Q-E2：採用**（沙盒包 dev、專屬 core）。**Q-E3：採用**（`attempts[]` 不清零，Resume 只把上限 `+2`，寫 `resumed` 事件）。

**對 8.2.4 邊界 1 到 3（Tuning 無沙盒、Runner 的測試無沙盒、讀取不受限）的回答：靠 skill 約束行為。** 做法：Planning 階段（user 在場）必須先釐清「進入 cycle 之前就要解決的外部依賴」，釐清不了就不准進入 cycle，cycle 內一律不連外網。

**這個決定能硬性做到的與做不到的（我的評估，待 owner 確認）：**
- **能硬性執行**：dev worker 的網路（沙盒已 deny，V38、V39）。所以「cycle 內不連外網」對 dev 是真的，不只是請求。
- **只能靠 skill／prompt（無硬性保證）**：Tuning（claude／codex）。它必須連 Anthropic／OpenAI 的 API，而 `sandbox-exec` 只能用 IP 與埠過濾，不能用網域，所以無法做到「只允許 API、擋其他」。Tuning 的「不連外網」只是指示，不是強制。
- **skill 的檢查必須落在 `init` 能機械檢查的欄位上**，否則只是文字承諾。建議（提案，未寫入 D14）：`tasks.json` 加 `"network":"none"` 與 `"external_needs":[]`（套件安裝、下載、API 文件等，Planning 階段先備妥並 commit 進 repo 或 vendor）；`init` 拒絕 `network` 不是 `none` 的內容、並掃 `test`／`verify` 指令是否含 `curl`、`wget`、`npm install`、`pip install`、`git clone`、`git push`。這能擋住「計畫就需要網路」，擋不住「model 臨時起意」。
- 讀取面（`~/.ssh` 等）仍沒有硬性保護，skill 約束同樣只是指示。

#### 8.2.6 第二輪審查（Fable 5.2 xhigh 與 Codex `gpt-6-astra` high）與本輪自驗結果（2026-11-16）

**審查方式**：兩位都是唯讀、拿到同一份問題（Planning 能否消除阻塞、步驟 6／8／9 的自我驗證、找出文件錯誤）。Codex 是在 owner 授權下，用 `herdr-app do tab.new` 開了一個可見的 `codex-astra` tab（`-s workspace-write -a never`，cwd 是暫存資料夾，只能寫 `answer.md`）；`hc` 用來監看。兩位的結論高度一致，下面只列結論與新增項。

**本輪我自己驗證完的（不需要 owner）**

| # | 結果 | 證據 |
|---|---|---|
| V42（步驟 5，U15 完成） | **真正脫離 process group 的 daemon（`os.setsid` 加雙重 fork）在 `hc kill` 後存活**，40 秒後還寫出標記檔。**收斂辦法有效**：worker 的環境變數帶 `ORCA_DISPATCH=<id>`，kill 之後 `ps -Eww` 找出帶該標記的程序並 kill，標記檔沒有出現。限制：這是「合作式」清理，不是邊界（清空環境、掃描與 kill 之間 fork、PID 重用都會漏或誤殺）；只驗了一種 daemon 寫法 | 實跑（專屬 core、沙盒內） |
| V43（步驟 7，腳本 worker） | 沙盒內腳本照 4.9 範本走五步：worker 寫得到 `results/`，寫不到 `state.json`、`dispatch/`、`~`，外網失敗；Runner 端檢查全過（porcelain 空、`is-ancestor`、commit 數 ≥1、重跑測試 exit 0、`state.json` 雜湊不變、結果 JSON 合法）。worker 腳本結束碼是 6（最後一個被擋的 `curl`），**terminal 結束碼不能當成敗依據** | 實跑 |
| V44（步驟 7 加碼） | **真的 opencode 1.7B（沙盒內）照 4.9 範本一次完成**：ack、建 `greet.sh`、測試通過、1 個 commit、結果檔合法、工作樹乾淨，約 40 秒。結果檔出現時狀態仍是 `working`（支持 M7）。**只跑一次**，推翻不了「遵從率低」的假說，也不證明它高 | 實跑 |
| V45（步驟 8-lite） | 專屬 core 的 terminal 內（`env -u XDG_*`）：`claude auth status` 為已登入、`codex login status` 為已登入、`opencode models` 含 `omlx/LiquidAI--LFM3-1.7B-MLX-4bit`。**只證明憑證與 model 找得到，不證明 Tuning session 能啟動** | 實跑 |

**兩位審查一致的結論（已採納為規格決定）**
1. **owner 的質疑對一半**：Planning 應把「已知且可準備」的阻塞消除掉，但執行期的阻塞（model 自己提問、額度、不穩定測試、環境漂移）原理上消除不了，Runner 的安全網不能拆。U13 從「驗收閘門」降為「量測延遲」：沒回報 `blocked` 時，60 秒靜止或 60 分鐘硬上限一樣進 `needs_user`，不會誤判成功。**U13 不再是 E2E 的閘門**。
2. **`init` 加「沙盒預檢」**（提案，D14 的擴充）：進 cycle 之前，在與 dev 相同的沙盒（網路 deny）內把每條 `test`／`verify` 跑一次，每條有時間上限。
   - 通過條件**不是 exit 0**：`tasks.json` 每條指令帶 `preflight:{expected:"pass"|"red", red_case?}`；紅測試必須用指定的失敗判準，不能把任意非零碼當成預期的紅。`sh: node: command not found`、缺套件、等輸入、逾時都不算 red。
   - **不能用 exit 127 判工具缺失**（被測的檔案尚不存在時同樣 127）。
   - 預檢紀錄由 `init` 自己產生，綁定 base HEAD、`tasks.json` 與測試檔雜湊、工具版本、沙盒政策；Planning 自填的 `preflight_passed` 不採信。
   - 在無 remote、停用 hooks 的拋棄式快照內跑，不在 owner 工作樹。
   - 證明範圍：只證明這次走過的路徑不需要網路；測試檔若由後續 task 才建立，標「未驗」。
   - `network:"none"` 只涵蓋 task 工具與驗收指令，**不含 Tuning 對模型 API 的傳輸**（否則 Tuning 本身就違反這條文字）。`external_needs` 記錄「已解決並落地的需求」（路徑與雜湊），不是強迫為空陣列。
3. **步驟 5、7、8-lite 不需要 owner**（已完成，V42 到 V45）。
4. **步驟 8 分三層**：①零額度的 fake CLI，只斷言 argv、model／effort 白名單、cwd、core 路由；②（已做）auth 與 model 檢查；③真 smoke **併進 E2E 的第一次 Tuning**，不另跑。第三層需要 owner 對「花少量 claude 額度」的授權，不需要陪跑。
5. **步驟 9 分兩段**：2.2 的 a 到 i 用假的 `hc` 加假的 `herdr-app`（PATH shim）寫單元測試，必須測真正 Runner 的判斷函式；未知呼叫一律失敗、不得退回真 CLI。真實 `tab.close`（U5）**不能被 shim 取代**，只剩 owner 確認一次。`HERDR_APP_HOME` 開第二個 App 視窗：兩位都認為**未證實隔離**（App 的 layout 存在 core 的 document，連上的視窗共用），不採用。**U5 不是核心 E2E 的閘門**：`close_planning_tab` 維持預設 `false`，U5 與 AT-03 留到最後。

**新增與需修正的風險（依嚴重度；M13 起為規格修正）**

| # | 風險 | 修正 |
|---|---|---|
| 1 | **專屬 core 的 address 會與你的 core 撞號**（兩邊都從 `t1` 起編），指令漏帶 `HC_SESSION` 就會殺到你的 terminal | **M13**：所有對專屬 core 的操作走包裝函式 `hc(){ HC_SESSION=… command hc "$@"; }`，破壞性指令前先斷言 core id ≠ 你的 core；優先用 `--name`／標籤，不用裸 address。（本輪我已照這個做。） |
| 2 | **loopback 放行是後門**：`localhost:*` 包含你無沙盒的 opencode service（`127.0.0.1:49374`），它能跑 bash，理論上可繞過寫入與網路限制。V39 與 8.2.4「買到的安全」過度宣稱 | 文字改為「dev 對部分路徑與直接外網受限」；E2E 稽核加 `lsof -i :49374`；查 `--standalone` 能否固定埠；換大 model 時重新評估 |
| 3 | **`needs_user` 不是物理停止**：被保留的 worker 可能繼續寫檔、耗額度；殺 Runner 不會殺 `--no-parent` 的 worker；測試與 Tuning 的後代程序同樣會逃 | **M14（取代 R-C 的「kill 不損失東西」）**：kill 之後依 V42 的環境標記掃描，核對 PID 身分、重新掃描、確認靜止；清不乾淨就保留證據並 `needs_user`，不得接受結果。中止流程涵蓋 runner、dev、tuning、test／verify／preflight 的後代 |
| 4 | Tuning 產生的 rework `test` 會在無沙盒的 Runner 執行，初始的 owner 核可與預檢沒涵蓋 | **M15**：rework 指令套用同一結構檢查與受限預檢，才可執行；「把整個 Runner 放進 dev 沙盒」行不通（Tuning 會失去 API 連線），測試的執行邊界與模型傳輸邊界要分開設計 |
| 5 | **M7 的「兩次輪詢不變」不證明 worker 已停止修改**（可能在寫 ignored 檔、持鎖） | 60 秒上限到了的處理要寫明；kill 後半寫的結果、殘留 `index.lock`、partial changes 一律停下保留，不自動 reset 或清鎖 |
| 6 | a 到 i 只檢查「一個 terminal」，不檢查 pane 結構（mod pane 也會被一起關）；「不到一秒的空窗」無法保證 | f 改核對 pane 結構，拿不到就不關；空窗改寫「無法保證」；維持預設關閉 |
| 7 | U13 把「工具直接拒絕」「CLI 等人回答」「worker 自報 blocked」混在一起；`status != done` 被記為 `rejected` 可能再重試，與 `blocked → needs_user` 不一致 | 三種出口分開處理；確定要改政策的阻塞不要重試 |
| 8 | 閘門不一致：E2E 要求階梯 5 到 9 全完成，卻又設定 `close_planning_tab=false`；`init` 的 E33／E34／E35 需要 App、Herdr terminal、claude／codex，與 E2E 直接呼叫 `init` 衝突；`init --check` 與 4.9 的旗標清單不同 | 閘門改為：U5 不擋核心 E2E；`init` 的測試入口釘死為 fake Planning 身分，並揭露與 production 檢查的差異 |
| 9 | 監控判準自相矛盾：「沒有新監聽埠」「repo 外無寫入」與 opencode 必須寫共用資料、起隨機 loopback 伺服器衝突；預估 40 到 70 分鐘卻以 40 分鐘中止；`find ~ -newer` 必有雜訊；秘密掃描 `grep -rEn` 會印出命中的整行，違反 D15 | 改成「允許路徑與程序的差分」；40 分鐘是硬停止；掃描只報檔名、行號與類別 |
| 10 | 環境洩漏：worker 繼承 `SSH_AUTH_SOCK` 與各種 API key 變數；`env -i` 會弄壞 opencode；`env -u XDG_*` 成立只因你的環境本來沒設 XDG | 改用白名單 `env -i HOME PATH TERM HC_SESSION …`，先用 opencode 實測 |
| 11 | 黑名單式沙盒下，`launchctl submit`、`open -a`、Apple Events 可在沙盒外起程序；放行 `/private/var/folders` 太寬 | 記為已知限制；1.7B 不會利用，換大 model 要重評 |
| 12 | V41 沒被 E2E 走到（E2E 用獨立 repo）；真實部署的 common-dir 放行可收窄為 git-dir 加 `objects`、`refs/heads/<branch>`、`logs/refs/heads/<branch>`、`packed-refs` | 在步驟 7 補一次 linked worktree 加真實 `results/` 路徑的驗證（未做） |
| 13 | 失敗分類只有 Runner bug／模型問題；「換大 model 通過＝1.7B 是原因」過強 | 分類改為 `environment / policy / model / runner / inconclusive`；8.2.1 第 1 項仍寫放行「狀態資料夾」，應為 `results/`；8.2.4 預測「1.7B 多半不遵約」撤回，不再量化猜測 |

**修訂後的驗證順序（★ = assistant 可單獨完成）**

| # | 內容 | 狀態 / 停止條件 |
|---|---|---|
| 1★ | 規格統一（M13 到 M15、閘門解耦、過度宣稱改寫、`init` 測試入口） | M13 到 M15 ★ 已寫入 4.4／4.9；其餘（閘門解耦、過度宣稱改寫、`init` 測試入口、8.2.1 第 1 項的 `results/`）待做 |
| 2★ | 無模型單元測試：D14、M6 到 M12、a 到 i（假 `hc`／`herdr-app`）、壞資料、未授權目標、逾時與恢復 | M13 到 M15 ★ 已完成（`my-orca/my-orca.test.mjs`，20 項，`node --test my-orca`）；其餘待做；任何不安全目標被呼叫、未驗收即成功、未知輸入卻放行 → 立即停止 |
| 3★ | `init` 沙盒預檢（含紅測試語意） | 待做；不能分類的失敗、必要網路、需提問、清理失敗 → 擋住 cycle |
| 4★ | fake worker 在專屬 core 跑停止、當掉、恢復、rework；把 V42 的清理接進真 Runner 的每條路徑 | 待做；殘留寫入、未知 PID、第二個 worker、跨 core 目標 → 停止 |
| 5★ | U13 最小真探針：先用 allow 的對照例確認工具確有被呼叫，再設 deny；沒有工具呼叫證據標 INCONCLUSIVE | 待做；60 到 120 秒上限 |
| 6★ | 補 V41（linked worktree 加真實 `results/`）與 1.7B 重複 3 次；Tuning 的 fake argv 測試 | 待做 |
| 7 | **E2E**（owner 只需同意時間點與少量 claude 額度；真 Tuning smoke 併入） | 達硬時限、core 身分變動、政策外寫入或網路、清不乾淨、超限 → 停止並保留現場，不自動 Resume |
| 8 | U5：`tab.close`（owner 確認一個拋棄式 tab，一次、不用 `confirmed`） | 最後才做；不擋 E2E；證據不全就維持 `close_planning_tab=false` |

#### 8.2.7 owner 的第二次決定（2026-11-16）：不用沙盒、全信任、每個 stage 自行 commit 與 push

**決定**（原話見對話；以下是我的整理）
1. **完全靠 prompt 保護。不用沙盒，全信任當前作業。** Q-E1 撤回，`dev_argv_prefix` 作廢。這個題目不再討論。
2. **需要自我測試才能回答的問題，由 subagent 驗證，不問 owner。**
3. **每個 stage（dev、Tuning、以及 Tuning 回推給 dev 的 rework）產生的任何 commit 或變更，必須由該 stage 自己在當下 `git commit` 並 `git push`**，理由是一切都被約束在 worktree 內。→ 新規則 **R-H**（下面）。
4. 「事後偵測」（比對其他分支 ref 等）：**不做**。一切視為在 worktree 範圍內。環境變數清理（`env` 白名單）同樣不做，併入第 1 項。
5. Q-E2（專屬 core）：先前選「最佳配置」，**維持**。它隔離的是 terminal 編號與你的 core，不是沙盒；M13 保留。

**因此作廢或降級的內容**（文中其他地方仍保留原文，以本節為準）
- V38、V39、V41 不再作為「安全」依據，只保留為事實紀錄；8.2.1 的第 1、10、11 項；8.2.4 的「買到的安全」與邊界 1 到 4、9；8.2.6 的風險 2、10、11、12 與「環境洩漏」「loopback 後門」；「E2E 可安全開跑」清單的第 ② 項。
- **M15 的沙盒預檢要求作廢**：不再有「通過預檢才能執行」的閘門（`my-orca.mjs` 的 `isRunnable` 與 `RISKY` 樣式屬於已作廢的部分；實作時處理）。M15 保留的是**結構檢查**（`title`、非空且非空測試、`deps` 規則、1 到 10 個、id 由 Runner 指定），因為它們防的是「誤判成功」，不是安全。
- 「沙盒預檢」提案（`preflight`、`network:"none"`、`external_needs`）作廢。Planning 的約束只剩：handoff 的「Constraints」章節，由 Runner 原文放進每個 worker 的 `dispatch/<id>.md`（見 R-H 的網路條款），再加上 M2（owner 事前核可 `test`／`verify`）。
- 保留不變：M13（專屬 core 的 core id 斷言）、M14（kill 後的程序掃描；它防的是「驗收之後程序還在改檔」這個正確性問題，與沙盒無關）、V36、V37、V42。

**R-H 每個 stage 自行 commit 與 push（新規則，取代 D3 的「不得 push」與 R-D 對 worker 的限制；Runner 本身仍然只讀、從不 push）**
- **適用**：dev task、Tuning 的直接修正、rework task，以及 Tuning 自己產生的任何變更。
- **worker 的步驟**：`git add -A && git commit` → `git push`（**不帶任何旗標**；不得 `--force`、不得 amend 或 rebase、不得改 branch 或另推別的 ref）→ 最後才寫 result 檔（M7 的「result 最後寫」）。
- **網路**：唯一允許的網路用途是對 upstream 的 `git push`。這修正了 8.2.5 的「cycle 內不連外網」：改為「除 `git push` 外不連外網」，靠 prompt 約束。
- **Runner 的驗收新增 (5)**：`git rev-list --count @{u}..HEAD` 必須是 0（純本地讀取，不連網路；`git push` 成功後 upstream 的追蹤 ref 會更新）。不成立**不算 `rejected`**，直接 `needs_user`（`unpushed`），不自動重派；user 自己 push 後按 Resume，或用 `--accept-head`。理由：Runner 不 push，worker 已被 kill，重派會被 R-D 判成 `tree_changed`。
- **`my-orca init` 新增檢查**：`git rev-parse --abbrev-ref @{u}`（要有 upstream）與 `git push --dry-run` 兩個**都要**通過（Planning tab 內執行，允許連網；不能用 `--dry-run origin HEAD` 取代，V47）；否則拒絕並指出原因（`no_upstream`、`remote_unreachable`、`not_fast_forward`）。
- **階段邊界的不變式**：進入下一個 stage 之前，工作樹乾淨且 `HEAD` 等於 upstream。
- **E2E**：remote 用暫存資料夾內的本機 bare repo，不接觸任何真實 remote。
- **已知限制**：Runner 的本地檢查只看到 upstream 追蹤 ref；`git push origin HEAD:refs/heads/other`、push 到第二個 remote、force push 後的狀態，能偵測到多少，待 subagent 驗證（見下）。

**已交給 subagent 驗證（結果回來後寫成 V46 以後）**
- A（**已完成，結果見 8.2.8**）：R-H 的 git 機制——linked worktree 內 `@{u}` 是否可用、各種狀態（同步、領先、落後、分歧、無 upstream、upstream 被刪、remote 不存在）下的退出碼與輸出、`git push --dry-run` 當 init 檢查、worker 的規避寫法哪些會被只讀檢查發現、commit 與 push 之間被 kill 的恢復、一次真的 opencode 1.7B 照新範本 commit 加 push。
- B：Tuning 的 claude 與 codex 能否在專屬 core 內以 argv 的指標 prompt 啟動並寫出 review 檔、有沒有對話框、狀態回報序列、結束後 terminal 是否維持 live、`foreground.argv` 是否保留 model 旗標（U12）。

**尚待收斂的問題（排除沙盒與信任之後）**
1. R-H 的機制細節與失敗路徑（等 subagent A）；Tuning 的 CLI 啟動行為（等 subagent B）。
2. **M7**：「兩次輪詢不變」不證明 worker 已停止修改；60 秒上限到了怎麼辦，規格沒寫。
3. **U13／`blocked`**：在 `--auto` 且無沙盒下，`blocked` 只會來自模型自己提問；三種出口（工具拒絕、等人回答、worker 自報 blocked）的處理不一致（`status != done` 被記為 `rejected` 可能重試，`blocked` 則進 `needs_user`）。U13 已降為非閘門。
4. **文件自相矛盾（純文字修正）**：E2E 閘門要求完成 U5 卻關閉該功能；`init` 的 E33 到 E35 前提與 E2E 直接呼叫 `init` 衝突；40 與 70 分鐘；「沒有新監聽埠」與 opencode 必須起 loopback 伺服器；秘密掃描的 `grep -rEn` 會印出命中行，違反 D15；8.2.2 的基準與稽核（`find ~`、`ps`、`lsof`）有一半是為沙盒寫的，需要重寫。
5. **U5／AT-03**：`tab.close` 未驗，a 到 i 沒涵蓋 pane 結構；維持預設關閉，最後才做。
6. **失敗分類**：加入 `environment / policy / model / runner / inconclusive`；撤回「換大 model 通過＝1.7B 是原因」。
7. **dev 的 model 誰指定**（Runner 寫 `opencode.json` 會弄髒工作樹）；E2E 用 repo 內已 commit 的設定，不影響。
8. **1.7B 遵從率**只有一次樣本，E2E 的 3 個 dev task 會量到。
9. 已 commit 的試作程式碼（`my-orca/my-orca.mjs`）有一部分已被本節作廢（見上），**實作階段開始時要先處理**；目前不改。

