# Orca parity implementation progress

2026-11-20 follow-up: Create PR is available for an already-pushed branch in the same non-fork GitHub.com repository, pinned to GitHub repository ID and the verified default base; real GitHub mutation and UI remain unverified. Worktree removal remains unavailable. Orca uses a separate `orca-worktree` mod.

Baseline checked 2026-11-20: Herdr worktree HEAD `1860df301e4afeeea884646c88642b599f7d8200`, Orca HEAD `30d56bd62b00f2432489f589aab15af9aa695fb1`, Herdr `0.9.5`. Orca worktree was clean; this worktree already had changes to `plan.md`.

This is an incremental record, not the M0 inventory or a claim of parity. `plan.md` remains the authoritative scope and its unchecked acceptance criteria remain open.

| Surface | Herdr | Status and evidence |
| --- | --- | --- |
| Pane menu | `mods/orca-menu/main.js` | Copying up to 10,000 terminal buffer lines is now named as a copy, not Select All; Herdr has no equivalent selection operation. Handoff label adjusted to plan. UI and clipboard unverified. |
| Explorer menu | `mods/orca-files/main.js` | Removed four shortcut hints that were only decorative. Keyboard behavior remains to be compared. |
| Explorer content search | `mods/orca-files/main.js` | Request generation and workspace context gate prevent stale results replacing newer results. UI and host switching remain to be verified. |
| All changes diff | `mods/orca-diff/` | An unborn repository shows staged and unstaged sections separately, including empty/untracked files; committed repos retain the net `HEAD` comparison. The preview reports the 20-untracked-file and 5,000-line limits and prevents older loads replacing newer results. Real Git fixtures cover special paths, binary files and no-HEAD repos. This remains a different operation from Orca's per-section View all; UI and remote hosts remain unverified. |
| Section View all | `mods/orca-changes/main.js`, `mods/orca-diff/diff-data.js` | Staged and Changes now open separate snapshots of the selected section paths; Changes includes unstaged and untracked, and both refresh current status without including other sections. Preview limits are visible, and a selected file replaced by a directory is rejected. VM tests cover click/keyboard wiring; temporary Git repos cover partially staged, untracked and no-HEAD cases. Conflict Review is not implemented; actual UI focus and remote hosts remain unverified. |
| Push / Commit & Push | `mods/orca-changes/main.js`, `commit-push.js`, `push-target.js` | Target resolution and isolated tests exist, but the UI is temporarily unavailable: the current host API cannot bind the validated URL to the Git process without exposing credentials in argv. Sync is also unavailable pending safe pull/rebase target handling. Real remote hosts and UI remain unverified. |
| Git destructive actions | `mods/orca-changes/main.js`, `discard-snapshot.js`, `operation-target.js` | Discard dialogs capture and display repository, host and paths; execution rejects changed workspace/host, index, file bytes or mode and uses literal Git pathspecs. Symlinks fail closed. Untracked clean no longer includes ignored files or nested repositories. Isolated repos cover target mismatch, changed bytes/index, binary, symlinks and pathspec-magic names. Snapshot and Git mutation remain separate operations, so concurrent changes after validation remain a risk. Publish, Rebase and PR creation are temporarily unavailable because their target or base was assumed rather than verified. |
| Force Push | `mods/orca-changes/push-target.js`, `mods/orca-changes/main.js` | The explicit confirmation and exact lease implementation is retained but temporarily unavailable in the UI until the validated URL can be bound to the Git process. Bare-repo tests cover remote movement, tracking changes, cancellation and branch changes. Credentials in ordinary push output are redacted, but arbitrary path-embedded secrets are not guaranteed. |
| Explorer deletion | `mods/orca-files/delete-target.js`, `mods/confirm/main.js` | Confirmation carries a unique target and captured workspace/host; changed context, lexical escape, missing target and symlink parent are rejected. Temporary-directory tests cover these checks. Shell checks and deletion are not atomic, target replacement is not detected, and actual host command routing, Windows shell availability and remote execution remain unverified; M1 is not complete. |
| Explorer create / rename / duplicate | `mods/orca-files/file-mutation.js` | Captures workspace and host; rejects invalid names, existing destinations and symlink parents, reports failures, and uses exclusive creation / no-clobber rename. Duplicate exclusively opens a new destination, copies bytes, then applies ordinary source permission bits through the open file descriptor; setuid, setgid and sticky bits are not copied. A failed copy may leave a partial private file and a racing duplicate may fail rather than retry. Temporary local tests cover collisions, concurrent copies, binary data, modes, special names and escapes. Shell path checks and actions are not atomic; source replacement races, remote host execution and Windows compatibility remain unverified. Editor writes need separate review. |

High-priority work remains, especially M0 inventory and M1 file and Git mutation safety. Isolated local Git fixtures have run; isolated Herdr core/session integration and two-app UI verification have not. Do not treat these incremental fixes as completion of any work package.

Verification by `gpt-6-luna` high: `node --test` passed 95 tests; `git diff --check` passed. An ephemeral harness exercised overlapping searches and a changed workspace key, but is not a persistent regression test. UI rendering, keyboard focus, clipboard, remote hosts and destructive operations have not been verified.

Follow-up: `gpt-6-luna` high reviewed the deletion and commit/push changes; isolated helper tests passed. Full `node --test` passed 99 tests. The deletion test exercises a temporary local directory with a simulated host argument; it does not establish remote or UI behavior.

Create/rename follow-up: `gpt-6-luna` high reviewed the implementation, verified macOS `mv -n` against an existing destination, and ran `node --test` with 100 passing tests. The host parameter is simulated in local tests; remote execution and the rendered prompt remain unverified.

Duplicate follow-up: `gpt-6-luna` high reviewed the exclusive-copy path and ran `node --test` with 101 passing tests on macOS. Linux `stat` fallback, failed read/stat/chmod cleanup, actual remote routing and UI feedback remain unverified.

Git safety follow-up: `gpt-6-luna` high reviewed the discard target guard and disabled remote actions; `node --test` passed 103 tests. The literal pathspec integration test uses the same Git option prefix as the mod. UI dialog operation, remote hosts, and changed file contents during confirmation remain unverified.

Discard state follow-up: `gpt-6-luna` high reviewed the snapshot gate and ran `node --test` with 107 passing tests. A temporary staged repo verifies that an index change aborts before reset without further file or index changes. This exercises the snapshot gate rather than the real GPUI dialog; symlink discard is intentionally unavailable and the validation-to-write race remains.

Push follow-up: `gpt-6-luna` high identified custom refspec and multiple-upstream ambiguity; both are now rejected and covered by temporary-repo tests. Remote push URLs, branches and commit IDs are rechecked before execution. Custom refspecs and triangular push setups may be unavailable even when ordinary Git can push; no actual network remote or GPUI behavior was tested.

Force Push follow-up: `gpt-6-luna` high reviewed the explicit lease and credential redaction and ran `node --test` with 114 passing tests. A push URL can still change after the last check but before Git resolves the remote name; URL redaction does not recognize every possible path-embedded secret. These remain open safety limitations.

Push destination dependency: Herdr's `exec(command, args, {cwd, on, timeout})` does not accept stdin or environment variables. A Git subprocess could pin a confirmed push URL without placing it in argv using command-scope environment configuration, but that needs host API support and must also account for `url.*.insteadOf` rewrites and retained remote transport settings. Passing credential-bearing URLs directly in argv would expose them. Until the host supports a verified binding, the URL check-to-push race remains open.

Editor follow-up in progress: autosave and leave-time writes now share a per-document queue. Failed leave-time writes retain a read-only in-memory draft for recovery; a successful pending save reloads the draft as editable. Worktree containment and path components are checked before enabling edits and before each local write; outside-workspace paths and symlinks are read-only. A symlink workspace root is rejected for editing and file mutations. VM and isolated directory tests exercise these checks, but the check and host write are not atomic, the draft is not durable across app exit, and actual UI and host bridge remain unverified.

Editor verification: `gpt-6-luna` high reviewed the queue, draft recovery and reload behavior; `node --test` passed 119 tests. The Herdr close-hook behavior on a rejected save and draft recovery after closing the view or app remain unverified.

Editor and root-boundary verification: `gpt-6-luna` high reviewed editor containment and root symlink checks for file create/rename/duplicate/delete and discard snapshots; `node --test` passed 122 tests. Actual Herdr host writes and race resistance remain unverified.

Diff follow-up: `gpt-6-luna` high reviewed no-HEAD, pathspec, stale-request, empty/binary/truncation and filename cases; `node --test` passed 129 tests. Git-quoted control characters remain visibly escaped in labels, and the two-app UI and remote-host behavior remain unverified.

Section View all follow-up: `gpt-6-luna` high reviewed section semantics and keyboard event handling; `node --test` passed 132 tests. Real GPUI focus, accessibility tree and remote execution remain unverified.

M0 inventory follow-up (2026-11-20, 接手): 新增 `parity-inventory.md` 盤點 `layouts/orca.json` 22 個可達表面與 overlay（surface → 入口 → Herdr/Orca 檔案 → 差異類型 → 狀態 → 證據），權限拒絕三處明示為待查，未標任何表面為 passed。接手複驗：`node --test` 132/132 通過（align-orca worktree），`git diff --check` 通過。本次未改 code，未做 M1 原子/草稿、新安全遠端目標、M2 快捷鍵或 M3–M9 實作；UI、遠端 host、Windows/Linux、隔離 Herdr core 整合仍未驗。

Worktree removal follow-up (2026-11-20): 新增 `mods/worktree/remove.test.js`（7 例）覆盖 main checkout 拒絕、identity 漂移、dirty 阻擋、branch/head 變化、stillCurrent 中途失效、clean 成功含 `worktree remove --` timeout/host、Git 拒絕透傳。`node --test mods/worktree/remove.test.js` 7/7；全套 139/139（當時）。

Panel gating follow-up (2026-11-20): 抽出 `mods/orca-panel-head/panel-gating.js`（`visibleTools` + `fallbackChild`）並 wire `main.js`；新增 `panel-gating.test.js`（4 例：git/folder/ssh 三態 + gated-active fallback）。行為與原本 inline filter 等同。全套 143/143、`git diff --check` 通過。

Duplicate cleanup follow-up (2026-11-20): `file-mutation.js` duplicate 失敗時 `rm -f "$dest"` 清掉不完整檔（原先明示可能殘留）。`file-mutation.test.js` 2/2；全套 143/143。check→write 非原子、遠端/Windows/UI 仍未驗。

Helpers extraction follow-up (2026-11-20): `mods/worktree/main.js` 純函式抽至 `helpers.js`（ROOT/tilde/slug/ago/place/inside/spaceOf），`ago` 可注入 now 便於測試；新增 `helpers.test.js`（4 例）。`main.js` 改 import，行為不變。全套 147/147、`git diff --check` 通過。

Keymap alignment / M2 (2026-11-20): `keys.json` 的 `layout:orca` 已改為 Orca 預設：`⌘1–9` 選 workspace、`⌃1–9` 選 tab（exchange）、`⌘]`/`⌘[` pane focus、`⌘⇧↑/↓` previous/next workspace、`⌘⇧E/F/G/I` 右欄 view、`⌘L` 右欄開關、`⌘R`/`⌘⌥R` tab/workspace rename、agent next/prev 移到 `⌘⌥⇧]`/`[`。右欄 view 由新 `mods/orca-panel-head/panel-views.js` + `init` bridge 執行 `layout.show` + `layout.select`；`⌘⇧F` 另送 `orca-files.search`，由 `orca-files` 切到 Contents 並 focus 查詢框。**保留的明確例外**：`⌘⇧T` reopen 無對應命令；`⌘P` 仍是 Herdr picker（Orca 是 Go to File，未假稱等價）；`⌘K` 未綁（Herdr palette 在 `⌘⇧P`）；`Ctrl+Tab` 仍為 `tab.next`（Orca 是 previousRecent/MRU）；`⌘⌥←/→` 保留為 Herdr 的 `pane.go`（Orca 是 worktree history，Herdr 無 history 命令）；`⌘⇧W` pane.close 為 Herdr-only。測試 `mods/keys.test.js`（5）與 `panel-views.test.js`（4）；實際按鍵、焦點與 macOS 終端攔截未驗。

Explorer keyboard / M4 (2026-11-20): `mods/orca-files` 樹現在有 focus scoped 的鍵盤操作：↑↓/Home/End/PageUp/PageDown 移動選取並 `scroll_to_item`，→ 展開/進入子項，← 收合/回父項，Space activate，Enter rename，Delete（或 ⌘⌫）開確認，`⌘⌥C`/`⌘⌥⇧C` 複製絕對/相對路徑。列有 `role:button` 與 a11y 名稱，選取與 preview 分開標示。純邏輯 `tree-nav.js` 由 `tree-nav.test.js`（5）覆蓋，VM 接線由 `tree-keys.test.js`（6）覆蓋（含未 focus、非 files view、路徑捕獲）。GPUI 實際 focus/滾動與 viewport 未驗；name filter 下的 expand 走 `nameToggle`。

Worktree create / M6 (2026-11-20): `create()` 先拒絕前導 `-` 與 slug 後為空的名稱（避免 Git 選項解析與把 checkout 指到 repo 根），再沿用既有 branch 或 `-b` 建新 branch；隔離 repo 的 `create.test.js`（4）涵蓋新 branch、既有 branch、無效名稱與 Git 拒絕後不開 space。路徑仍在 `~/.herdr/worktrees/<repo>/<slug>`；遠端、UI 與 base 選擇（Orca 可選 base，Herdr 固定 HEAD）未做。

Menu + a11y / M3+M8 (2026-11-20): workspace 選單的 `Workspace` 標題改為只在 multi-select context 顯示（`WorktreeContextMenuView.tsx:147-152`），目前 Herdr 無多選所以不再顯示。`actionButton` 加上 `role`/`accessibility_label`/`disabled`，檔案的 Stage/Unstage 有實際標籤（Orca `uncommitted-entry-row.tsx:253,263`）；diff 關閉鈕也有名稱。顏色、hover 與實際 a11y tree 未驗。

Doc sync (2026-11-20, 本次): 重跑 `node --test` 147/147、`git diff --check` 通過；已把 `plan.md` 交接段落後的 132 更新為 147，並補上 worktree remove、panel gating、duplicate 清理與 helpers 抽取的實際狀態。`parity-inventory.md` 第 7、19 列原寫「未見專屬 new tests／未 wire」，與現況不符，已同步為 `panel-gating.test.js`（4 例）與 `remove.test.js`（7 例）。該次文件同步本身未改 mod 程式碼。

Latest verification (2026-11-20, 本輪): `node --test` **171/171** 通過、`git diff --check` 通過。本輪新增 24 個案例（keys 5、panel-views 4、tree-nav 5、tree-keys 6、worktree create 4）。仍未做：真的啟動兩個 app 的 UI/focus/clipboard/accessibility tree、視窗尺寸、遠端 host、Windows/Linux 與隔離 Herdr core/session 整合。M0 仍有 6 個表面標「待查」（#1–3、6、17、21）與 3 處權限缺口；#22 keymap 已部分 aligned 但需實機按鍵驗；M1 的原子性與遠端目標問題、Push 系列 disabled、M5 conflict merge editor、M7 Agents 支援範圍、M9 float 等價皆未完成。
