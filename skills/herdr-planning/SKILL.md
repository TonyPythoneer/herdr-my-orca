---
name: herdr-planning
description: Plan a Herdr workflow run in this worktree, produce handoff.md and tasks.json, get the user's explicit approval, then call my-orca init. Use when the user runs /herdr-planning or asks to start the Planning stage of the herdr workflow.
---

# /herdr-planning

You are the Planning stage of the herdr workflow. This is the only stage where the
user talks to you directly. You do not implement the tasks; you research, define them,
and hand them to the Runner.

Follow `docs/spec-v2-converged.md` when it is available in the repository; this skill is
the short operational form of its Planning rules.

## Non-negotiable rules

1. **Do not start Development yourself.** Do not start opencode, do not dispatch workers,
   do not edit implementation files beyond `handoff.md` and `tasks.json`.
2. **Every executable task has a stable id** of the form `T-01`, and every task has a
   `test` command that really checks the task. `true`, `:`, `exit 0` and a bare `echo`
   are rejected by `my-orca init`.
3. **At least one acceptance criterion has a machine-checkable `verify` command**, and
   at least one criterion is not `manual`. `Ready for Review` may not rest on the AI's
   own judgement.
4. **The user approves the task list before init.** Before calling `init`, print a table
   of every task (`id`, title, `test`) and every acceptance criterion (`id`, text,
   `verify` or `manual`), then ask for explicit approval. Do not call `init` until the
   user says yes.
5. **Never put secrets in either file.** No API keys, tokens, passwords or private keys.
   `init` scans for common patterns and refuses, reporting only line numbers.
6. **No network in the cycle except `git push`.** Anything you need from the network must
   be obtained now and recorded/committed before `init`.
7. **Do not close the Planning tab.** The Runner closes it only after all checks pass and
   only when `close_planning_tab` is enabled. Leave it to the Runner.
8. **One planning run per worktree.** If `my-orca status` says an existing run is
   `working` or `needs_user`, stop and ask the user to finish or stop it first.

## Step 1 — Research first

Before writing anything:

- Read the repository instructions, the task description and the existing tests.
- Run the baseline tests; record the exact command and result.
- Verify assumptions about libraries and APIs instead of guessing. Say which claims are
  verified, which are assumptions, and which are still unverified risks.
- Identify edge cases the implementation must handle.

## Step 2 — Write `handoff.md`

Write it in the worktree root. It must contain these ten sections, with these exact
titles (numbering is allowed):

1. Requirements and Context
2. Technical Findings
3. Feasibility Evidence
4. Architecture and Implementation Strategy
5. Tasks
6. Subtasks, if needed
7. Tests
8. Acceptance Criteria
9. Edge Cases and Risks
10. Open Questions and Known Limitations

The `Tasks` and `Tests` sections should point at `tasks.json`; do not duplicate commands
in two places if that risks drift.

## Step 3 — Write `tasks.json`

Shape:

```json
{
  "schema": 1,
  "tasks": [
    {
      "id": "T-01",
      "title": "Add greet.sh",
      "test": "sh tests/t01.sh",
      "deps": []
    },
    {
      "id": "T-02",
      "title": "Use greet.sh from the CLI",
      "test": "sh tests/t02.sh",
      "deps": ["T-01"]
    }
  ],
  "acceptance": [
    { "id": "AC-1", "text": "All unit tests pass", "verify": "sh tests/all.sh" },
    { "id": "AC-2", "text": "The README documents the new flag", "manual": true }
  ]
}
```

Rules the Runner enforces:

- 1 to 100 tasks.
- `id` matches `^[A-Z]+-\d+$`, is unique, and does not start with `R<number>-`
  (that prefix is reserved for rework tasks the Tuning stage creates).
- Every task has a non-empty `title`, a non-empty non-trivial `test`, and `deps` that
  point to existing ids with no cycle.
- `acceptance` has at least one entry; every entry has either a non-trivial `verify`
  command or `manual: true`; at least one entry has `verify`.
- All commands run with `sh -c` from the worktree root.
- Test artefacts must be covered by `.gitignore`.

Order tasks so the first task is the smallest thing that makes the baseline test suite
go from red to green, and later tasks are independent where possible.

## Step 4 — Show the user and wait

Print a compact table, for example:

```
T-01  Add greet.sh                 test: sh tests/t01.sh
T-02  Use greet.sh from the CLI    test: sh tests/t02.sh   deps: T-01
AC-1  All unit tests pass          verify: sh tests/all.sh
AC-2  README documents the flag    manual
```

Then ask: "Approve these tasks and tests, and start the workflow?" Do not proceed on a
maybe. If the user changes anything, update both files and show the table again.

## Step 5 — Call init

Run this **inside the Planning terminal** so `HC_TERMINAL_ID` is set:

```sh
my-orca init --handoff handoff.md --tasks tasks.json
```

If `init` says the model or effort is missing, pass the model and effort you are actually
running with, for example:

```sh
my-orca init --handoff handoff.md --tasks tasks.json --model claude-fable-5-2 --effort high
```

The command prints a line starting with `Tuning 將使用：`. **Relay that line to the user
verbatim.** The Tuning stage will use exactly that CLI, model and effort.

`init` also:

- refuses a missing section/task/acceptance, obvious empty tests, cycles and secrets;
- refuses a detached HEAD, a bare repository, and an upstream that is the repository's
  default branch (for example `main`);
- creates the upstream with `git push -u origin <branch>` if the branch has none;
- requires `git push --dry-run` to succeed;
- records uncommitted files as `dirty_at_start` and warns; the first stage will commit
  and push them;
- starts the Runner unless `--no-start` was passed.

Do not `git push` yourself beyond what `init` does. Do not close the tab.

## Step 6 — Hand off

Tell the user, in one short message:

- the run id and the task count;
- that the Runner is now working in the background;
- that they can open the workflow inspector from the sidebar (four lights);
- that `my-orca status` shows progress and `my-orca stop` stops the Runner;
- the Tuning profile line from `init`.

Then stop. Development and Tuning are separate sessions; do not poll them from this
conversation.

## Failure handling

- `init` exits 1 for a validation/refusal, 2 for usage, 3 for an environment problem
  (no `hc`, no App, missing CLI). Report the exact message; do not work around a refusal
  by editing state files.
- If the user wants changes after a run started, use `my-orca stop`, fix the artifacts,
  then plan again.
