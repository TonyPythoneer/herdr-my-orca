# Task management: schedules on Herdr's own API

- **Author:** Tony Yang
- **Branch / worktree:** `feature/wt-task-management` (`~/git/herdr-my-orca.worktrees/wt-task-management`)
- **Status:** implementation notes; the spec below is what was built.

## What the person gets

A clock icon in the Agent Settings footer row, between **Model providers** and **Settings**
(`mods/orca-chrome/main.js`, the `agents / providers / settings / help` row). It opens a
Settings-style page in the `main` stack, next to the Agent Manager and Model providers pages.

The page lists **tasks**: a task is a schedule plus a command to run at that time. Its first
job is the one asked for: when a paid subscription CLI's usage window resets, send one tiny
ping with the cheapest model at the lowest effort, so the new window starts at the reset
instead of whenever the person next types. Two tasks are seeded for **Claude** and **Codex**.

## Why it is built this way

Herdr and herdr-core expose no timer, cron or scheduler: `herdr-app commands` has no such
command and `hc` has no "run at"; `hc wait` waits for something else, it does not schedule.
So the schedule itself is a mod timer, and everything it does goes through the native surface:

| Need | Native call |
|---|---|
| wait for the next due time | `cx.timer.every(ms, cx)` (a mod's own timer; keep it `cx`-safe) |
| run the ping, capture its output and exit code | `exec(argv[0], argv.slice(1), { cwd, timeout })` (`herdr.d.ts`) |
| read/write the task list | `readTextFile` / `writeTextFile(path, text, expected)` (atomic, expected-snapshot) |
| share config, reset times and run state between the page and the runner | `shared(key)` / `setShared(key, value)` (persisted, re-renders every mod) |
| tell the runner a page edit or **Run now** landed, now | `setShared("tasks.request")` + `run("orca-chrome.tasks-scan")` (mod command, `nextCommand()`) |
| show a failure | `notify(...)` (the layout's `toast` mod) |
| open the page | `layout.select {stack:"main", child:"main-tasks"}` |

No launchd job, no daemon, no `cron`, no background process of our own. The schedule runs
while Herdr runs; the page says so.

### Where the timer lives, and why not in the page

A mod copy starts the first time it is shown, then stays alive while its block stays in the
layout (`AGENTS.md`, "Mods"). The Tasks page is a stack child that is usually not the active
one, so it would never start on a fresh launch and its timer would never see the reset.
`orca-chrome`'s footer copy is in both layouts and always on screen, so the runner lives
there (`mods/orca-chrome/runner.js`, started from `orca-chrome.init` when `props().footer`).
The page is then only the editor/status view, and it can be opened at any time.

### Reset times: which file, and what was verified

The reset instants already exist on this computer, and `mods/orca-status` reads the same
files for the quota bar. The runner re-reads them with one `sh` script (no network):

- **Claude** `~/.cache/herdr-usage/claude-statusline.json` — Claude Code's `rate_limits`
  (`five_hour` / `seven_day`, `resets_at` in epoch seconds) written by
  `claude-statusline.sh` on every interactive turn, and
  `~/.cache/herdr-usage/claude-oauth.json` — the `api.anthropic.com/api/oauth/usage`
  snapshot orca-status refreshes every 15 min (`resets_at` is an ISO time there).
  Per window the newer `resets_at` wins, the same rule `claude-statusline.sh` merges with.
- **Codex** the newest `~/.codex/sessions/**/rollout-*.jsonl` that contains `"primary":{`,
  its `rate_limits.primary` / `secondary` (`window_minutes`, `resets_at` epoch seconds).

Verified on this machine (2026-11-23, 13:35):

- `claude -p "ping" --model haiku --effort low` runs in ~4 s and **does not** touch
  `claude-statusline.json` (print mode does not run the statusLine script), so the live
  statusline file cannot confirm a ping. The OAuth snapshot can, and the engine does not
  depend on that confirmation (see the rules below).
- `codex exec -m gpt-5.6-luna -c model_reasoning_effort=low ping` appends a new rollout and
  exits 1 with `You've hit your usage limit … try again at 1:53 PM` when the window is spent.
  That is why a failed run retries soon instead of waiting five hours.
- When Codex is limited it writes `primary: null`; the probe skips files that do not contain
  `"primary":{`, exactly like `mods/orca-status/local-usage.js` does.

### Cheapest model at the lowest effort

- **Claude:** `haiku` + `--effort low`. Claude Code's own `initialize` control response lists
  `haiku` (`claude-haiku-5-5`) and the effort levels `low … max`; `low` is the minimum.
- **Codex:** the catalog from `codex debug models` carries no price. The small/fast tier is
  the `luna` family and it sits last in the visible list, so the seed takes the last visible
  catalog entry (`gpt-5.6-luna` today) with `model_reasoning_effort=low`. The seeded argv is
  plain data in `tasks.json`; when the catalog changes, edit it, or delete the two tasks and
  they are seeded again.

## Data: `~/.config/herdr-app/tasks.json`

```json
{
  "version": 1,
  "tasks": [
    {
      "id": "claude-reset-ping",
      "name": "Claude reset ping",
      "enabled": true,
      "agent": "claude",
      "trigger": { "type": "reset", "provider": "claude", "window": "h5", "delaySeconds": 5 },
      "argv": ["claude", "-p", "ping", "--model", "haiku", "--effort", "low"],
      "cwd": null,
      "last": { "at": 1795413000000, "code": 0, "note": "ok", "fails": 0 }
    }
  ]
}
```

- `trigger.type`: `reset` (`provider` `claude|codex`, `window` `h5|wk`, `delaySeconds`) or
  `daily` (`time` `HH:MM`, local). Nothing else is scheduled today.
- `argv` is the whole one-shot command; `exec` runs it without a shell, so no quoting is
  needed. `cwd` null means the person's home.
- Unknown fields are kept, so a later version can add one without losing it.

`tasks.json` is configuration only. The reset instants, each task's last run (epoch ms, exit
code, the last non-empty output line cut to 300 chars, consecutive failures), the next due
time and the "running" flag live in `shared` (`tasks.resets`, `tasks.config`, `tasks.text`,
`tasks.state`), which Herdr persists. The runner therefore never rewrites the person's file:
it seeds one, and the page is the only writer after that. A `tasks.request` shared value is
how the page's **Run now** asks the runner to fire a task, so one place owns runs.

## The schedule rules (pure, in `shared/tasks.js` → copied into both mods)

`nextRunAt(task, { now, resets, lastAt, lastCode, fails })`:

- **reset**
  - last run failed → retry after 2 min, and after 4 failures every 30 min (a Codex window
    that has not rolled over yet, a machine that is offline). No silent five-hour wait.
  - the window is live (`resets_at > now`) → run at `resets_at + delaySeconds`.
  - the window is idle (`resets_at` missing or in the past) → run now: that is the reset the
    person asked to trigger.
  - never before `lastAt + window length` when the last run succeeded: the window it started
    is still running, so a restart or a stale usage file cannot ping twice inside one window.
- **daily** → the next local `HH:MM`; a time that passed while Herdr was closed is still
  owed for that day (it fires on the next tick), and after a run the next one is tomorrow.

A due task is one whose `nextRunAt` is `<= now`. The runner checks every 10 s (cheap file
read and comparisons, no `cx.notify()`, so no redraw), and immediately on the page's
`orca-chrome.tasks-scan` nudge.

## Files

- `shared/tasks.js` (new; source of truth) → copied by `scripts/sync-shared.mjs` into
  `mods/orca-tasks/tasks.js` and `mods/orca-chrome/tasks.js`.
  - parse/serialize/seed, `nextRunAt`, `describeTrigger`, `formatCountdown`,
    `RESET_SCRIPT` + `parseResets`, `runTask(execFn, task)`, `tail`.
- `mods/orca-tasks/` (new): `main.js` (the page), `mod.json` (`{"place":"none"}`),
  `tasks.js` (generated), `tasks.test.js`.
- `mods/orca-chrome/`: `runner.js` (new: load/seed, probe, fire, persist), `tasks.js`
  (generated), `main.js` (start the runner for the footer copy + the new footer icon).
- `layouts/orca.json`, `layouts/orca-unified.json`: `main-tasks` block in the `main` stack.

## The page

- Header: back arrow (to `main-terminals`), "Task management", **New task**.
- **Reset windows** card: Claude and Codex, the 5h window only (weekly is not used), each
  with the time it resets and the countdown. This is the data the schedules fire on.
- **A plan that does not meter the 5h session** (higher subscription tiers drop that limit)
  is detected from the CLIs' own reports and the 5h row says "no 5h limit on this plan". Every
  5h reset task for that provider turns grey and inert — the On/Off switch becomes a
  **Disabled** pill, **Run** loses its hover and click, the card dims to 55% — and the engine
  never schedules it (`nextRunAt` returns null). Delete stays available. Nothing is written to
  `tasks.json`: if the plan ever meters the window again, the task comes back on its own.

  Detection is data, not a setting: Claude is exempt when its live statusLine report or its
  OAuth snapshot carries a weekly window but no `five_hour`/`session` one (an API-key or
  bedrock session is "unknown", never greyed); Codex is exempt when the newest rate-limit
  report has a real window and none of them is the 300-minute one. No report at all is
  "unknown", so a CLI that has not run yet never greys anything out.
- **Tasks**: one card per task — name, agent, On/Off toggle, trigger line with the next run
  ("At Claude 5h reset · in 12m"), the argv, the last run (time, code, note), **Run now**,
  **Delete**.
- **Edit JSON** toggles a textarea over the whole file: names, argv, trigger, everything a
  card does not cover. Saving validates before writing; a stale write re-reads and retries.
- New task adds a disabled daily template (09:00, Claude ping) and opens the editor.

## Non-goals

- Interval triggers, per-task machine/space, running in a visible tab, reminders, history.
- Weekly resets are not shown and not seeded; `window: "wk"` still works if the person writes
  one into `tasks.json`, and it is not greyed by the 5h exemption.
- Tasks do not run while Herdr is closed. The page says so.

## Verify

1. `node --test mods scripts` and `node scripts/sync-shared.mjs --check`.
2. `herdr-app check ~/.config/herdr-app/mods/orca-tasks` and `…/mods/orca-chrome`.
3. Icon in the footer sits between Model providers and Settings and opens the page.
4. Live run test (done): a temporary daily task with `sh -c "echo task-ok"` fired on its
   minute, `tasks.state` recorded exit 0 and the note, and the next due time moved to
   tomorrow. Both seeded reset tasks show the live windows' `resets_at + 5s` as their next
   due time (`shared.json` → `tasks.state`), so they will fire at the real reset.
5. A failing ping (Codex while limited) shows the CLI's message and retries in 2 min.
6. Exemption, checked by rendering the real page through the test loader with a weekly-only
   report: the 5h row says "no 5h limit on this plan", the card wears the **Disabled** pill at
   55% opacity, its **Run** has no `on_click`/hover/cursor, and the other provider's card keeps
   its clickable Run.
