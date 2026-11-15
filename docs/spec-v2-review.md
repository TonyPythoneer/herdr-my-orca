# CTO Review — spec-v2.md(Herdr My Orca v4.0)

審閱日期 2026-11-16。所有「已驗證」項目都是在這台機器上以唯讀指令或檔案確認的:`hc 0.1.21`、`herdr-app 0.1.15`、`opencode v2.3.0`、`claude 2.1.311`(agent-config catalog 快取)、`node v26.13.1`。無法在不啟動 agent 或連網的情況下確認的,一律標示「unverified」。

## 1. Verdict

照原文寫法**不可直接開工**:它把四個互相牴觸的前提(state root、誰擁有 Planning session、`hc` 的 `first_message` 只在 template 啟動時存在、opencode 是否回報 OSC 7501 狀態)當成已知,而其中兩項在這台機器上已經確定是錯的(`~/.herdr` 不存在、`hc templates` 是空的),另外兩項未驗證。砍掉重疊的狀態欄位、把 20 條錯誤處理壓成 6 條規則、把「三個 skill」改成「一個 skill + 兩個 hc template」之後,核心需求(背景單工 dev loop + 四燈 UI)是一個人兩到三天可以交付的東西。**最大單一風險:opencode 在 hc 底下是否回報 `working/blocked/done`**——若否,整個 Runner 的等待與 `blocked` 偵測(AT-21)、以及 dev worker 的「完成」判定都得改成純 result-file 驅動,這必須是第一個 preflight,而不是實作中途才發現。

## 2. What to watch(依嚴重度排序)

### R1. State root 與現有實作直接衝突(已驗證)

- spec §6 要求 `~/.herdr/herdr-my-orca/`。這台機器 `~/.herdr` 不存在,`~/.config/herdr-core/` 也不存在(所以也沒有 templates、config.toml)。
- 現有 `mods/orca-workflow/main.js:19` 讀的是 `${appHome()}/herdr-orca-workflow.md`,而這個檔也不存在,所以現在 board 永遠顯示 SAMPLE。
- Mod 端的限制(`AGENTS.md:1036`):`fs/promises` 只能寫 `~/.config/herdr-app` 底下;`writeTextFile` 標示 local only,是否限制路徑 unverified。`watchFolder` 在 macOS 遞迴且含 ignored 目錄(`herdr.d.ts:411-421`),任何本機路徑都可監看。
- 結論:再開一個 `~/.herdr` 只會多一個無人維護的 dot-dir。建議統一到 `~/.config/herdr-app/my-orca/`(UI 可讀、可 watch、可寫 config,零新權限),並把現有的 `.md` 改成 `state.json`(`model.js:parseDoc` 本來就接受 bare JSON)。

### R2. `stage` / `execution_stage` / `status` / `progress.*` 四個軸互相重疊

§6 schema 同時存了 `stage`、`execution_stage`、`status`、四組 `progress.{accepted,total}`、`development.active_task_id`、`development.queue`、`tuning.rework_cycles`。這些全部可以從 `tasks[]` 推導,存兩份就會不一致(例如 rework 時 `progress.development.total` 要不要回加?spec 說「update the relevant total and preserve previous counts in event history」,這和 `revision` 檢查的語意打架)。只存 `stage` + `rework` + `tasks[]`,四盞燈在讀取端算。

### R3. 四燈 vs 現有三卡 board(已驗證差異)

- 現有 board:三卡、大卡片、`review_return_to_implementation` 旗標、agent rows 以 `agents()` 依 address 解析、每 5 秒輪詢 md 檔、以 `openOverlay({kind:"dialog", width:0.9, height:480})` 打開。
- spec §8:四燈、「avoid large cards」、第四燈是 gate(`00/01`)不是 task、要「inspector」、要 peek。
- 兩者不是互斥,是「strip + inspector」兩層。但有一個隱藏 bug:`agents()` 只列**視窗內**的 terminal(`herdr.d.ts:182-183`,有 space/tab/pane 欄位);Runner 以 `--bg` 且不掛 `herdr.space` 標籤起的 worker 不在裡面,現有 board 會把它們全部顯示成 `offline`。必須改用 `terminals()`(每個 core terminal 都列,含 `labels`、`parent`、`status`),而 `terminals()` 不會觸發 re-render(`orca-pane/main.js:32` 註解已踩過),所以要搭 `cx.timer`。

### R4. `--bg` 背景 terminal 與 peek(部分已驗證)

- 已驗證:`hc run --bg --label K=V --no-parent --no-notify --outlive-parent --rm` 全部存在;`herdr.space`/`herdr.tab` 標籤才會讓 terminal 進視窗,「Unlabeled workers stay hidden」(`herdr-app --skill`);`terminal.peek {terminal}` 是正式命令(「peek over the tab, with keep-as-tab and close」);`openOverlay({kind:"window", layout:{... {terminal:"t7"}}})` 也可以。
- unverified:`terminal.peek` 對**沒有** `herdr.space` 標籤的 terminal 是否可用。shipped `peek` mod 以 `terminals()` 做 fallback(`mods/peek/main.js:22-29`),暗示可以,但要以 `herdr-app do terminal.peek --terminal <addr>` 實測一次。
- 注意 `claude --bg` 是 Claude 自己的 background session,與 `hc run --bg` 不是同一件事;template 的 `command` 不可混用。

### R5. `first_message.sent` 只存在於 template 啟動(已驗證)

`hc schema` 的 `RunResult.first_message` 描述為「Template runs: whether the first message went in」。目前 `hc templates` 回 `{"templates":[]}`。spec §4 要求「inspect first_message.sent before considering dispatch successful」等於**強制使用 template**。這是好事(template 把指令和任務合成第一則訊息,60 秒 readiness 重試),但代表:
- dev template(`orca-dev.md`,`command: opencode`)可以是靜態檔。
- tuning template 的 `command` 必須含 Planning 的 model/effort,而 TemplateInfo 的 `command` 是檔案裡的固定字串,所以 Runner 要在 planning 結束時**產生** `orca-tune-<run>.md`。這個細節 spec 沒寫。
- opencode 互動模式的 positional 參數是 directory 不是 prompt(`opencode --help`),`opencode run "msg"` 是 one-shot(hc 手冊明文禁止)。所以 opencode 的第一則任務**只能**靠 template 的 send 或 `--prompt`,不能像 claude 那樣 `hc run --bg opencode "task"`。

### R6. Tuning 必須重用 Planning 的 model——CLI 能力落差(已驗證 + unverified)

- claude:`--model X --effort L`;codex:`-m X -c model_reasoning_effort=L`、且在 hc 下必須 `--no-daemon`。這三點都是 owner 自己的 `mods/agent-config/main.js:32,49` 與 `programs.json` 在用的,已驗證。
- `hc get <t> --json` 的 `argv` 完整保留啟動參數(實測 t4v 的 argv 含 `--model sonnet --effort high`);OSC 7501 `records` 只有 `app/state/title`,**沒有 model**。所以「capture the selected model」唯一可靠來源是 argv,不是 agent 的自我回報。
- opencode 互動模式**沒有** `--model`(只有 `opencode run --model`,one-shot)。dev worker 的 model 只能走 opencode config 預設;spec 寫「Preserve the resolved model ID」對 dev 階段做不到,對 tuning 階段(claude/codex)做得到。
- spec §3.1「If the exact model is unavailable, request an explicit configuration」這條分支可以整個刪掉:profile = Planning terminal 的 argv,永遠可得。

### R7. opencode 是否回報 OSC 7501(unverified,最高優先 preflight)

`hc` 的 status 全靠程式自己送 OSC 7501(`idle/working/done/blocked/error`),「plain programs report none」。這台機器的 6 個 live terminal 都是 claude/codex。若 opencode 不回報:`hc wait <t>` 只會等到 exit;`blocked` 永遠偵測不到;`hc wait` 的「launch task counts as working until…」語意失效。那整個 dev loop 必須改成「template 指示 worker 寫完 `results/<task>.json` 後自行結束(exit)」,Runner 以 exit + result file 判定。spec 的 AT-21 對 opencode 就只能是 NOT TESTED。

### R8. Planning 到底是誰的 session(spec 內部矛盾)

§5「All Planning… sessions must operate in the background」vs §3.1「Never terminate a user-owned interactive terminal」+ AT-03「Planning's workflow-owned session closes safely」。Planning 是需求釐清階段,user 要跟它對話,放背景沒有意義。建議:Planning 在 user 自己的 tab 跑 `/herdr-planning`,skill 最後呼叫 `my-orca init --profile-from $HC_TERMINAL_ID`,Runner 從此接手。AT-03 照原文**無法誠實 PASS**,要改寫成「Runner 從不 kill 任何未在 state 記錄且未帶 `orca.run` 標籤的 terminal」。

### R9. Runner 失效模式

- **Crash 在 dispatch 與 commit 之間**(spec #11/#12/#19):`hc run --bg --json` 回來才知道 address。正確順序是:先寫 `dispatch:{id, address:null}` 到 state → `hc run --label orca.dispatch=<id>` → 寫 address。重啟時若有 `address:null` 的 dispatch,用 `hc ls --json` 列 address、逐一 `hc get` 比對 `labels["orca.dispatch"]`(注意:`hc ls --json` 是精簡格式,**沒有 labels**,只有 address/agent/cwd/state/status/turn/where),找到就認養,找不到才重派。有了標籤就不需要 `revision`。
- **並發寫入**(#13):一個 worktree 一個 Runner process,`runner.lock` 以 `O_EXCL` 建立含 pid,寫檔走 tmp + rename。`writeTextFile(expected)` 是 UI 端的樂觀鎖,夠用。
- **Core 重啟**(#18):hc 手冊明寫「After a core crash, an unchanged final root word/turn cannot prove completion」——支持 spec「只信 result artifact」的立場。Runner 本身建議放在 hc terminal 裡(`hc run --bg --no-parent --name orca-runner my-orca run <wt>`),core 幫你保活、`hc read orca-runner` 就是 log、UI 可以 peek 它。worker 用 `--no-parent --no-notify`,否則 child 的 `<hc from=…>` note 會被打進 Runner 的 stdin。
- **等待**:單一 worker 只需 `hc wait <addr> --json` 迴圈(`ended:false` + `reason:timeout` 是 check-in,180 秒一次);不需要 `hc events`。`reason: not_started` 要讀 `first_message.started`。
- **Timeout 不是失敗**(#8):Runner 要有硬上限(例如 dev task 90 分鐘)→ `NEEDS_USER`,否則一個卡住的 opencode 會讓 workflow 永遠 `working`。spec 沒給數字。

### R10. 權限模式與 spec 的「Do not automatically approve」矛盾(已驗證)

`programs.json` 以 `claude --dangerously-skip-permissions`、`codex --dangerously-bypass-approvals-and-sandbox` 啟動;opencode 有 `--auto`。在這個設定下 `blocked(kind=permission)` 不會發生,§9 第 7 條與 AT-21 的 permission 分支實際上是空集合。owner 要決定背景 worker 是否沿用這些旗標(我建議沿用:背景 session 沒人回答 prompt,blocked 只會變成 NEEDS_USER 噪音)。

### R11. 22 個 AT 裡誠實評估

| 類別 | AT | 狀況 |
|---|---|---|
| 可直接 PASS(stub agent 測 Runner) | 05, 06, 07, 12, 13, 14, 19, 20 | 需要一個會送 OSC 7501 並寫 result file 的 `fake-agent.sh`;這不是 mock Runner,是 stub agent,spec 允許 |
| 需要一次真實 E2E(拋棄式 repo) | 04, 08, 09, 10, 11, 22 | 每次跑都燒 token 且 30 分鐘起跳;只跑一次,其餘回歸用 stub |
| 需要 `herdr-app check` + `shot` 人工看圖 | 15, 16, 17, 18 | 可驗證,但「自動化 PASS」是假的;寫成「shot 附圖 + 人眼確認」 |
| 依 preflight 才知道 | 01(argv 可得→PASS)、21(opencode 無 7501 → NOT TESTED) | |
| 照原文無法 PASS | 03 | 見 R8,改寫 |
| 02 | 「complete and validated handoff」要有機器可驗的定義(10 個必要 section 標題存在 + 每個 task 有 id/test),否則只是 LLM 自評 | |

### R12. 其他 unverified / 不支援

- **Reduced motion**:`herdr.d.ts`、`AGENTS.md`、`gpui-kit.d.ts` 都找不到任何 reduced-motion 設定;只有原生 `.loop("opacity", …)`、`.spin()`、`.frames()`。寫成已知限制,不要為它做 toggle。
- **opencode 讀 skill 的路徑**:這台沒有 `~/.config/opencode/skill*`;`~/.claude/skills -> ../.agents/skills` 是 symlink,`~/.codex/skills/` 存在。opencode 是否讀 `~/.agents/skills` 無法離線驗證——但若 dev 指令全放在 template body,opencode 根本不需要裝 skill。
- `readTextFile` 上限 1 MiB:`events.jsonl` 不要讓 UI 讀,UI 只讀 `state.json`。
- `exec` 預設 30 秒、上限 10 分鐘:UI 不可用 `exec` 等 Runner,只能發命令後回頭 watch 檔案。

## 3. What to simplify or cut

**核心需求只有一句話**:user 在自己的 tab 做完 planning 之後,一個不會死的小程式用 opencode 一次做一個 task、做完給原本的 model 驗收、最多來回三次,然後四盞燈告訴 user 現在到哪。以下每一項都是「去掉它仍然滿足這句話」:

| spec 要求 | 建議 | 理由 |
|---|---|---|
| 三個 skill(`/herdr-planning` `/herdr-dev` `/herdr-tuning`) | **一個 skill + 兩個 hc template**:`herdr-planning` 裝到 `~/.agents/skills`(claude 走 symlink、codex 複製一份);dev/tuning 的指令寫進 `~/.config/herdr-core/templates/orca-dev.md` 與 Runner 產生的 `orca-tune-<run>.md` 的 body | template 本來就會把 body + task 合成第一則訊息;省掉 opencode skill 路徑這個未驗證項,也省掉「worker 忘了叫 skill」這種失敗 |
| `schema_version` + `revision` + file locking + revision checks | `schema: 1` 一個整數、`runner.lock`(O_EXCL pidfile)、tmp+rename 寫檔;UI 寫 `config.json` 用 `writeTextFile(expected)` | 單一 writer,`revision` 沒有讀者 |
| `stage` + `execution_stage` + `status` + `progress.*` + `development.queue` | 只存 `stage`、`rework:{cycles,max}`、`tasks[]`;一切推導 | 見 R2 |
| `<repo-id>/<worktree-id>.json` + `runs/<run-id>/…` 兩層 | `my-orca/<worktree-id>/{state.json, events.jsonl, handoff.md, results/}`;完成後整個目錄改名 `<worktree-id>-<ts>` 歸檔 | v4.0 一個 worktree 一個 active run,run-id 就是 worktree-id |
| 四個標籤 `orca.run/stage/task/role` | `orca.run`、`orca.dispatch`、`orca.task` 三個;stage/role 由 task 推 | `orca.dispatch` 才是防重派的那個,spec 反而沒有 |
| 20 條錯誤處理 | 6 條規則:(a) 只有 `results/<task>.json` + Runner 自己重跑 test 命令才算 accepted(涵蓋 5,6,8,9,10,21);(b) dispatch 標籤 + 重啟認養(11,12,14,19);(c) pidfile + rename(13);(d) 硬 timeout → NEEDS_USER(8);(e) 啟動時 `git status --porcelain` 快照,Runner 從不 checkout/reset,worker 每 task 一個 commit(15,20,22);(f) rework 上限 + 每輪新增 task 上限 10(16,17) | 其餘(1,2,3,4,18)是 `my-orca init` 的前置檢查,各一行 |
| `hc events` 事件流 + 「bounded reconciliation」 | `hc wait <addr> --json` 迴圈 | 單工,一次只等一個 |
| 「Runner independent of AI sessions」+ 自訂保活 | Runner 自己跑在 `hc run --bg --no-parent` 的 terminal 裡 | core 已經是 supervisor |
| Tuning 可「直接做小修」+ 「revalidate all direct modifications」 | v1 **砍掉**:Tuning 只能產 rework task 或判 PASS/NEEDS_USER | 「直接修」就是第二個 worker,破壞 single-worker 與 result-file 單一真相;要的話 v2 再加 |
| Reduced-motion、Inspector 的「session history」 | 砍 reduced-motion(平台不支援);history = `events.jsonl` 最後 20 行,UI 不讀,留給 `my-orca status` CLI | |
| 「unit, integration, and actual E2E」三層 | `node --test` 跑 state machine + stub agent 的 Runner loop;真 E2E 跑一次,手動 | |

**建議的 v1 切片(先做)**:preflight → `my-orca`(init/run/status/config)+ stub agent 測試 → 兩個 template → planning skill → 一次真 E2E → 改 `orca-workflow`(state.json、`terminals()`、peek、四欄)→ strip。**延後**:Tuning 直接修、多 worker、session history UI、reduced motion、遠端 machine(`watchFolder`/`writeTextFile` 都 local only)。

## 4. Clarified action points

### Preflight(先做,結果決定設計;需要 owner 啟動 agent,我沒跑)

| # | 工作 | Done 條件 |
|---|---|---|
| P1 | 在拋棄式 repo:`hc run --bg --no-parent --name probe-oc opencode`,然後 `hc get probe-oc --json` 看 `status` 與 `records` | 記錄 opencode 是否回報 OSC 7501 `working/idle/done/blocked`;否 → dev loop 改 exit + result-file 模式 |
| P2 | 寫 `~/.config/herdr-core/templates/orca-dev.md`(`command: opencode`),`hc run --bg --json orca-dev "reply ok"` | `first_message.sent === true` 且 `started` 非 null |
| P3 | 對 P1 那個無 `herdr.space` 標籤的 terminal 跑 `herdr-app do terminal.peek --terminal <addr>` | peek 疊層出現、關閉後 `herdr-app ls` 沒有多出 tab |
| P4 | 把一個最小 `SKILL.md` 放進 `~/.agents/skills/herdr-planning/`,並複製到 `~/.codex/skills/` | claude 與 codex 各自看得到 `/herdr-planning` |
| P5 | 用現有 `orca-files` 的寫檔路徑測 `writeTextFile("~/.config/herdr-app/my-orca/config.json", …, null)` | 檔案建立;再以錯的 `expected` 寫一次會 reject |
| P6 | mod 內 `watchFolder(appHome()+"/my-orca/<wt>")`,外部以 tmp+rename 覆寫 `state.json` | watch 回傳該路徑 |

### 實作(依序,每項一行 + done 條件)

1. `my-orca`(單檔 Node,無相依):`init --profile-from <t> --handoff <path>`、`run <wt>`、`status --json`、`config set max_rework_cycles N` → `node --test` 覆蓋 state 轉移與 tmp+rename + lock。
2. `fake-agent.sh`:讀 task、印 OSC 7501、寫 `results/<task>.json`、exit → Runner loop 測試:dispatch→wait→validate→commit→`hc kill`+`hc rm`;在 dispatch 與 commit 之間 `kill -9` Runner 後重啟,**不**出現第二個 `orca.dispatch` 標籤的 terminal(AT-05/06/07/19)。
3. `orca-dev.md` template + Runner 在 planning 結束時生成 `orca-tune-<run>.md`(command = profile argv + `--no-daemon` for codex)→ `hc templates` 列出兩者,`first_message.sent` 為 true。
4. `herdr-planning` skill:產出 `handoff.md`(10 個 section 標題)+ `tasks.json`(每 task 有 `id/title/test/deps`),最後執行 `my-orca init` → `my-orca init --check` 對缺 section 或缺 `test` 的 task 回非零。
5. 在拋棄式 repo 跑一次真 E2E(2 個 dev task + 1 個刻意失敗的 acceptance 觸發 1 輪 rework)→ AT-04/08/09/10/11/14/20/22 各附 `hc get` 與 `git log` 證據。
6. Rework 上限、每輪新增 task 上限、硬 timeout → `NEEDS_USER`;全過 → `READY_FOR_REVIEW`(stub 測 AT-12/13)。
7. `orca-workflow` 改讀 `state.json`、`watchFolder` 取代 5 秒輪詢、agent rows 改 `terminals()` + 5 秒 timer、每列加 peek 按鈕 `run("terminal.peek",{terminal})`、第四欄 gate → `herdr-app check` 通過 + `shot`(AT-15/16/17)。
8. 四燈 strip mod + `layouts/orca.json` 新增 28px block(見 §5)→ check + shot。
9. UI 寫 `config.json`(`max_rework_cycles` 限 1..9,`writeTextFile(expected)`)、Runner 每次轉移前重讀 → AT-18。
10. README 新增一節(啟動/查看/暫停/恢復 + state schema 十行)→ 不另開文件。

### Open questions(owner 開工前回答;括號是我的預設)

1. State root:`~/.config/herdr-app/my-orca/` 或堅持 spec 的 `~/.herdr`?(**前者**;後者 UI 寫 config 要另闢路徑)
2. Planning 在 user 自己的 tab 跑、Runner 不管它(**是**);還是 Runner 也用 `--bg` 起 Planning?
3. 背景 worker 沿用 `programs.json` 的 `--dangerously-*`/opencode `--auto`?(**沿用**;否則 blocked 無人回答)
4. P1 若 opencode 不回報 OSC 7501,接受「worker 寫完 result 自行 exit」的設計?(**接受**;AT-21 對 opencode 標 NOT TESTED)
5. dev 階段 model 走 opencode config 預設、不逐次 pin(**接受**;互動模式無 `--model`)
6. worker 每個 task 一個 commit(`orca: <task-id>`),Runner 以 `git status --porcelain` 基線保護 user 的未提交變更(**是**)
7. Strip 放哪:sidebar-footer 上方新 28px block(**預設**)、底部 24px `orca-status` 左側、或 floating?
8. 命名:spec 的 `my-orca-status` 與現有 `orca-status`(底部列)太像(**改 `orca-workflow-strip`**;inspector 留 `orca-workflow`)

## 5. 現有 `mods/orca-workflow` 的演進

**Keep**:`model.js` 的純函式 + `node:test`(`parseDoc` 已接受 bare JSON;`stageCards` 的 clamp 邏輯直接重用)、dialog 開啟方式(`orca-chrome/main.js:54`)、以 theme token 畫圖的做法。

**Extend(inspector 角色)**:
- 資料源:`${appHome()}/my-orca/<worktree-id>/state.json`,`watchFolder` 取代 `cx.timer.every(5000)`;worktree-id 由 `focused()?.cwd` 或 `spaces()` 的 folder 經 `exec("git", ["rev-parse","--show-toplevel"])` 推(`exec` 已驗證)。
- `stageCards` 的第二參數從 `agents()` 換成 `terminals().filter(t => t.labels?.["orca.run"] === run_id)`,按 `orca.task` 分組;配 5 秒 timer(`terminals()` 不觸發 re-render)。
- 每個 agent row 加「Peek」:`run("terminal.peek", { terminal: a.address })`,不再需要 `agent_addresses` 欄位。
- 四欄:加 `ready_for_review` 卡,`total` 固定 1、`completed` 由 `stage === "ready_for_review"` 推;`review_return_to_implementation` 改成顯示 `rework.cycles / rework.max`。
- 卡片縮一號(spec 說 avoid large cards),但 dialog 本身保留:它就是 spec 要的「lightweight inspector」。

**New(strip 角色)**:`orca-workflow-strip`,`place: "none"`,掛在 `layouts/orca.json` sidebar-footer **上方**新增的 28px block。四盞燈 = 8px 圓 + 標籤 + `05/05`;working 用 `.loop("opacity",{from:.5,to:1,period:1200})` 原生脈動,completed 疊一個 `circle-check.svg`(`orca-status/` 已有),needs_user/failed 用 `triangle-alert.svg`/`alert-circle.svg`(也已有),滿足「不只靠顏色」。點燈 → `openOverlay({mod:"orca-workflow", kind:"dialog", props:{stage}})`,inspector 預選那一欄。顏色依 spec 四個 hex 常數,不走 theme(stage identity 色在明暗主題一致是 spec 要求)。

**刻意偏離 spec 的點**:不另立 `my-orca-status` mod 名;不做 reduced-motion toggle;inspector 不顯示 session history(給 `my-orca status`);不在 UI 內直接寫 state.json(只寫 `config.json`)。

**Replace**:`herdr-orca-workflow.md` 這個檔名與 markdown-fence 格式廢棄;`SAMPLE` 保留做無 state 時的空狀態示意,但文字改為「No workflow in this worktree · run /herdr-planning」。
