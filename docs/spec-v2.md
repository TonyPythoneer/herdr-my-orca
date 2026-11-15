<!-- Status: v2 spec as supplied by the owner (2026-11-16), recorded verbatim. CTO review: docs/spec-v2-review.md -->

# Herdr My Orca — Complete Implementation Specification v4.0

## Role & Mission

You are a Principal Software Engineer specializing in AI agent orchestration, reliable workflow systems, and native Herdr App development.

Design, implement, install, and validate **Herdr My Orca**, a lightweight multi-agent development workflow built on the official Herdr App and Herdr Core.

This is an implementation task, not a proposal-writing exercise.

Research the installed Herdr environment, verify the official APIs, implement the complete solution, run tests, and report the actual results.

**Prioritize simplicity, reliability, minimal token consumption, and native Herdr functionality. Avoid unnecessary abstraction or infrastructure.**

---

## 1. Mandatory Research & Preflight

Before implementation, inspect the actual environment and read the current official documentation.

Official references:

- https://github.com/herdrdev/herdr-core
- https://github.com/herdrdev/herdr-core/blob/master/crates/herdr-core/src/SKILL.md
- https://github.com/herdrdev/herdr-core/blob/master/docs/commands.md
- https://github.com/herdrdev/herdr-app
- https://github.com/herdrdev/herdr-app/blob/master/defaults/AGENTS.md
- https://github.com/jkuepker/herdr-layouts/tree/main/board
- https://opencode.ai/docs/skills

Execute and inspect the relevant output of:

```bash
hc --version
hc --skill
hc server status
hc templates
hc ls --json
hc schema --json
herdr-app --skill
herdr-app commands
herdr-app status
```

Verify actual CLI flags, agent status behavior, model configuration mechanisms, Mod APIs, and installation paths.

Use `hc` for Herdr Core automation, not the legacy `herdr` TUI CLI.

Use official APIs wherever possible.

Do not invent CLI arguments, API methods, model identifiers, or configuration paths.

Record the detected versions and any unsupported features.

If an implementation detail differs from this specification because of the installed Herdr version, follow the verified API while preserving the required behavior.

---

## 2. High-Level Architecture

The system must contain only these major components:

1. Three workflow Skills.
2. One lightweight, non-LLM Workflow Runner.
3. Persistent JSON workflow state.
4. One native Herdr App Mod for visual monitoring and limited configuration.

Do not introduce CAO, external orchestration frameworks, databases, cloud services, or a persistent LLM supervisor.

### Workflow

```text
User starts workflow
        |
        v
PLANNING
Claude Code / Codex
- Capture intelligence profile
- Analyze requirements
- Verify feasibility
- Identify edge cases
- Create handoff.md
- Define tasks/tests/acceptance
        |
        | Handoff gate passed
        v
DEVELOPMENT & TESTING
OpenCode
- One worker at a time
- One fresh session per task
- Implement and test
- Persist results
- Close session
- Consume next task
        |
        | All required development gates passed
        v
VALIDATION & FINAL TUNING
Original Planning CLI + Model
- Fresh session
- Independent review
- Acceptance tests
- Add rework tasks if needed
        |
        +-- Rework required --> Development queue
        |                      (max 3 cycles by default)
        |
        +-- Isolated final fix --> Revalidate
        |
        +-- Unresolved risk --> NEEDS_USER
        |
        +-- All gates passed
        v
READY FOR REVIEW
Human review required
```

The three primary stages are Planning, Development, and Tuning.

Ready for Review is a final workflow state, not another AI Skill.

---

## 3. Exactly Three Skills

Implement exactly these Skills:

- `/herdr-planning`
- `/herdr-dev`
- `/herdr-tuning`

Do not create `herdr-goto-dev`, `herdr-goto-tuning`, or similar transition-only Skills.

Each Skill must include its own completion and handoff requirements.

The Workflow Runner executes the resulting state transitions.

### 3.1 /herdr-planning

At workflow initialization:

1. Resolve the Git repository and worktree identity.
2. Register a unique Workflow Run ID.
3. Identify the current Planning Agent CLI.
4. Capture the selected model, provider, reasoning effort, and relevant configuration.
5. Persist this as the immutable `intelligence_profile`.
6. Verify that an equivalent fresh Tuning session can later be launched.

Do not infer model configuration from the CLI name alone.

If the exact model or reasoning configuration is unavailable, request an explicit configuration instead of guessing.

Planning responsibilities:

- Understand requirements and existing code.
- Research relevant architectural decisions.
- Validate technical feasibility.
- Verify API compatibility.
- Examine existing tests and baseline behavior.
- Identify likely implementation problems and edge cases.
- Define implementation tasks and optional subtasks.
- Define corresponding tests.
- Define objective acceptance criteria.

Planning must distinguish:

- Verified evidence.
- Reasonable assumptions.
- Unverified risks.
- Tests that cannot yet be executed.

Produce `handoff.md` with these mandatory sections:

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

Every executable task must have a stable Task ID.

Tests must identify expected behavior and the commands or verification methods required.

Planning completion:

- Validate the handoff document and task definitions.
- Persist all artifacts.
- Request the transition to Development.
- Let the Runner close the workflow-owned Planning session.

Never terminate a user-owned interactive terminal automatically.

### 3.2 /herdr-dev

Development must use OpenCode.

For v4.0:

```json
{
  "agent_cli": "opencode",
  "max_concurrent_workers": 1,
  "scheduling": "sequential",
  "session_policy": "fresh_per_task"
}
```

Implement a persistent task queue.

Only one Development Worker and one active development task are allowed at a time.

For every eligible task:

1. Launch a new background OpenCode session.
2. Load the necessary handoff context.
3. Load the current Task ID and task-specific requirements.
4. Implement the task.
5. Execute the required tests.
6. Resolve test failures within the assigned scope.
7. Persist task results and testing evidence.
8. Report completion, failure, or blocker.
9. Allow the Runner to validate and persist the results.
10. Close the completed Worker session.

Start a fresh session for the next task.

A single task may use multiple model turns within its session.

Do not automatically create subagents.

Task dependencies must be respected.

If a task is blocked, do not silently skip it or mark it successful.

After all mandatory Development tasks and tests pass, automatically request Tuning.

### 3.3 /herdr-tuning

Tuning must use the intelligence profile captured at the beginning of Planning.

Examples:

- Claude Code Planning → Claude Code Tuning.
- Codex Planning → Codex Tuning.

Preserve the resolved model ID and reasoning configuration.

Always use a fresh session. Do not restore the original Planning context.

Tuning responsibilities:

1. Read `handoff.md`, task results, and test evidence.
2. Independently review implementation changes.
3. Run relevant acceptance and regression tests.
4. Identify missing requirements, defects, and weak test coverage.
5. Generate new rework tasks and tests when needed.
6. Delegate appropriate corrections to Development.
7. Directly perform small and well-isolated final fixes when justified.
8. Revalidate all direct modifications.
9. Decide whether every acceptance criterion has passed.

Rework policy:

- Default maximum: 3 Tuning-to-Development cycles.
- The maximum must be configurable through the Herdr UI.
- Count a rework cycle only when a new rework batch is committed.
- Maintain a complete revision history.
- Never automatically reset the counter.

If the remaining issues are few but difficult, Tuning may finish them directly when scope and risk are manageable.

If substantial unresolved issues remain after the maximum rework cycles, enter `NEEDS_USER`.

Do not force the workflow into Ready for Review.

When all acceptance gates pass, transition to `READY_FOR_REVIEW`.

The Runner closes each completed Tuning session.

If further validation is required, create another fresh Tuning session using the locked intelligence profile.

---

## 4. Lightweight Workflow Runner

Implement a small deterministic program called the **Workflow Runner**.

The Runner is not an AI Agent.

It does not perform planning, coding, or subjective review.

It is responsible only for:

- Reading and updating workflow state.
- Selecting the next eligible task.
- Starting background Agent sessions.
- Waiting for execution events.
- Validating result artifacts.
- Enforcing stage transitions.
- Enforcing single-worker execution.
- Tracking rework cycles.
- Safely terminating completed sessions.
- Recovering interrupted workflows.

Prefer a minimal implementation with few dependencies.

The Runner must be independent of temporary AI sessions.

Use verified Herdr Core commands, including:

- `hc run`
- `hc send`
- `hc wait`
- `hc get`
- `hc read`
- `hc events`
- `hc kill`
- `hc rm`
- `hc label`

Use `hc run --bg` to launch background Agents.

Use `--no-parent` or an equivalent verified ownership strategy where necessary to ensure Agent termination does not unexpectedly terminate the Runner or other workflow sessions.

Prefer Agent Templates with the first task included in the launch request.

Inspect `first_message.sent` or the equivalent delivery acknowledgment before considering dispatch successful.

A timeout does not mean failure.

An idle or done Agent does not mean its task passed acceptance.

The Runner must validate task artifacts independently of terminal activity status.

### Runner Lifecycle

```text
LOAD STATE
    |
    v
RESOLVE NEXT ACTION
    |
    v
START BACKGROUND AGENT
    |
    v
WAIT / MONITOR
    |
    v
CHECK RESULT ARTIFACT
    |
    v
COMMIT STATE
    |
    v
CLEAN UP SESSION
    |
    v
NEXT TASK / NEXT STAGE
```

Use event-driven monitoring where available, with bounded reconciliation for missed events.

Avoid excessive polling.

The Runner must be restartable without losing already completed tasks.

Do not build a general-purpose distributed orchestration framework.

---

## 5. Background-Only Execution

This requirement is critical.

**Workflow-created AI sessions must not create regular Herdr Tabs, Spaces, or visible terminal panes.**

All Planning, Development, Tuning, and Runner sessions must operate in the background, except when the user explicitly requests inspection.

Use Herdr Core background terminals.

Do not apply `herdr.space` or `herdr.tab` labels to hidden workflow terminals.

Do not invoke `tab.new`, `pane.split`, or similar UI operations for routine workflow execution.

Use custom terminal labels for identification, such as:

```text
orca.run=<run-id>
orca.stage=<stage>
orca.task=<task-id>
orca.role=<role>
```

Validate these labels against the installed Herdr version.

Keep workflow terminals discoverable through Herdr Core.

The user must be able to inspect a background session on demand without permanently adding it to a normal Tab.

Use an official peek, overlay, or equivalent native App mechanism when supported.

If the originating session is a user-owned visible terminal, never close or remove that terminal automatically. Only workflow-owned ephemeral sessions may be cleaned up.

---

## 6. Persistent Workflow State

Store state outside the project repository.

Required root:

```text
~/.herdr/herdr-my-orca/
  workflows/
    <repo-id>/
      <worktree-id>.json
      runs/
        <run-id>/
          handoff.md
          tasks.json
          results/
          reviews/
          tests/
          events.jsonl
```

Use stable repository and worktree identities derived from Git metadata.

Do not rely on repository names or branch names alone.

Branch names may contain `/`, and multiple worktrees may share the same repository.

One active workflow per worktree in v4.0.

### Required State Schema

```json
{
  "schema_version": 4,
  "revision": 1,
  "run_id": "run-example",
  "repository": {
    "repo_id": "<stable-repo-id>",
    "worktree_id": "<stable-worktree-id>",
    "branch": "<branch-name>"
  },
  "stage": "development",
  "execution_stage": "development",
  "status": "working",
  "intelligence_profile": {
    "source": "planning",
    "agent_cli": "codex",
    "provider": "openai",
    "model": "<resolved-model-id>",
    "reasoning_effort": "<resolved-setting>",
    "locked": true
  },
  "development": {
    "agent_cli": "opencode",
    "max_concurrent_workers": 1,
    "scheduling": "sequential",
    "session_policy": "fresh_per_task",
    "active_task_id": "I-03",
    "queue": ["I-04", "I-05"]
  },
  "tuning": {
    "use_planning_intelligence_profile": true,
    "rework_cycles": 0,
    "max_rework_cycles": 3
  },
  "progress": {
    "planning": {
      "accepted": 5,
      "total": 5
    },
    "development": {
      "accepted": 7,
      "total": 12
    },
    "tuning": {
      "accepted": 0,
      "total": 6
    },
    "ready_for_review": {
      "accepted": 0,
      "total": 1
    }
  }
}
```

This is the minimum conceptual schema. Extend it for task assignments, terminal ownership, dispatch IDs, attempts, artifacts, timestamps, and recovery state.

### Data Integrity

Implement:

- File locking.
- Atomic writes.
- Revision checks.
- Stable Task IDs.
- Unique Dispatch IDs.
- Attempt tracking.
- Schema validation.
- Durable transition history.

Use a single authoritative state-writing interface.

Workers must not directly overwrite global workflow state.

The UI must not directly edit the JSON execution state.

Configuration changes must pass through validated commands.

Never persist API keys or authentication secrets.

---

## 7. Workflow State Machine

Primary stages:

```text
PLANNING
    ↓
DEVELOPMENT
    ↓
TUNING
    ↓
READY_FOR_REVIEW
```

Execution states:

- `pending`
- `working`
- `blocked`
- `needs_user`
- `failed`
- `completed`

During Tuning rework, preserve the primary stage:

```json
{
  "stage": "tuning",
  "execution_stage": "development",
  "rework_cycles": 2
}
```

This preserves forward-only primary stage progression while allowing Development rework.

When rework is complete, return execution to Tuning with a fresh review session.

Ready for Review means all automated acceptance requirements have passed.

It does not mean a Git merge, deployment, or human approval has occurred.

---

## 8. Native Herdr UI — Four-Light Status Strip

Implement a native Herdr App Mod named `my-orca-status`.

Use the supplied SVG references as the design specification.

Do not implement the interface as HTML, CSS, or an embedded browser.

Use Herdr's native GPUI JavaScript Mod system.

### Default Appearance

Display exactly four compact workflow indicators:

1. Planning
2. Development & Testing
3. Validation & Final Tuning
4. Ready for Review

Use a single horizontal status strip suitable for a Herdr toolbar or compact sidebar.

Avoid large cards, long descriptions, permanent Agent lists, or additional workflow Tabs.

Each indicator must display:

- A small colored status light.
- Stage label.
- Accepted task count.
- Total required task count.
- Compact progress indicator.

### Required Color Tokens

| Stage | Color | Hex |
|---|---|---|
| Planning | Indigo Violet | `#7E66CC` |
| Development & Testing | Azure Blue | `#367CE9` |
| Validation & Final Tuning | Warm Gold | `#C38B35` |
| Ready for Review | Emerald Green | `#139D78` |

Preserve the same semantic colors in light and dark themes.

### Light Behavior

- Completed: solid lamp with a check.
- Working: illuminated lamp with a subtle animated halo.
- Pending: dimmed hollow ring.
- Needs User: explicit warning indicator.
- Failed: explicit error indicator.

Do not rely on color alone to communicate status.

The stage color represents the stage identity. The lamp treatment represents its execution state.

Support reduced-motion settings.

### Progress Rules

Display:

`accepted tasks / total required tasks`

Examples:

- Planning: `05 / 05`
- Development: `07 / 12`
- Tuning: `00 / 06`
- Ready for Review: `00 / 01`

Only accepted tasks increment the completed count.

Agent `done` or `idle` status must not increment task progress.

The Ready for Review counter represents its final acceptance gate, not implementation tasks.

If Tuning adds required tasks, update the relevant total and preserve the previous counts in the workflow event history.

### Interaction

Clicking a stage indicator must open a lightweight inspector.

The inspector shows:

- Active or historical workflow-owned Agent sessions.
- Agent CLI and model.
- Current Task ID.
- Agent status.
- Session history or last result.
- Relevant blockers.

Allow the user to inspect a background Agent terminal through a native peek or overlay.

Do not create a permanent Tab merely to inspect an Agent.

If there are no sessions, display a clean empty state.

### Configuration

Expose:

- Maximum Tuning-to-Development rework cycles.
- Default value: `3`.
- Validated settings update.
- Current Development Worker limit: `1`, displayed as read-only in v4.0.

Do not implement multi-worker scheduling in v4.0.

### Data Sources

Use persistent workflow JSON for:

- Stage status.
- Task counts.
- Workflow transitions.
- Task assignments.
- Rework limits.
- Acceptance results.

Use Herdr Core / App APIs for:

- Agent status.
- Terminal presence.
- Live activity.
- Terminal inspection.

Do not infer task completion from OSC 7501 alone.

Use the documented App file-reading and folder-watching APIs.

Avoid uncontrolled polling and unnecessary UI re-renders.

---

## 9. Error Handling & Recovery

The implementation must explicitly handle:

1. Missing Herdr Core.
2. Missing OpenCode CLI.
3. Unavailable Planning/Tuning model.
4. Failed or incomplete handoff.
5. Agent startup failure.
6. Undelivered first prompt.
7. Agent blocked on permission approval.
8. Timeout without confirmed failure.
9. Agent exit without a result artifact.
10. Tests failing despite Agent reporting success.
11. Runner interruption or crash.
12. Duplicate dispatch risk.
13. Concurrent JSON writes.
14. Stale or reused terminal references.
15. Branch or worktree changes.
16. Tuning generating excessive additional tasks.
17. Rework limit exhaustion.
18. Herdr Core restart.
19. User-owned terminal accidentally selected for cleanup.
20. Unexpected partial modifications to project files.

Do not automatically approve unknown permission prompts.

Do not silently retry tasks that may have already executed.

Do not overwrite pre-existing user changes.

Protect the working tree and preserve Git history.

If recovery cannot establish a reliable state, enter `NEEDS_USER` and provide diagnostic details.

The Runner must never declare success solely because an Agent process exited.

---

## 10. Implementation Deliverables

Deliver the following:

### A. Three Skills

- `herdr-planning`
- `herdr-dev`
- `herdr-tuning`

Install them in the appropriate supported Skill locations for the intended Agents.

### B. Shared Workflow Runner

Implement:

- Workflow initialization.
- Task scheduling.
- Agent launch and cleanup.
- Persistent state management.
- Stage transitions.
- Rework cycle tracking.
- Crash recovery.
- Diagnostics.

### C. Native Herdr Mod

Create:

- `my-orca-status`
- Native compact four-light UI.
- Light and dark theme support.
- Agent inspector.
- Background terminal inspection.
- Configurable rework limit.

### D. Documentation

Provide:

- README.
- Installation instructions.
- Usage examples.
- Configuration reference.
- State schema documentation.
- Recovery and troubleshooting guide.
- Explanation of verified limitations.

### E. Tests

Provide unit, integration, and actual end-to-end tests.

Avoid mock-only validation of the complete workflow.

---

## 11. Mandatory Acceptance Tests

Every test must be reported as `PASS`, `FAIL`, or `NOT TESTED`.

| Test ID | Acceptance Test |
|---|---|
| AT-01 | Planning captures the actual CLI and model configuration. |
| AT-02 | Planning produces a complete and validated handoff. |
| AT-03 | Planning's workflow-owned session closes safely. |
| AT-04 | Development launches a background OpenCode session without creating a regular Herdr Tab. |
| AT-05 | Only one Development Worker executes at a time. |
| AT-06 | Each new Development task receives a fresh session. |
| AT-07 | Development results persist after session cleanup. |
| AT-08 | Development advances automatically to Tuning. |
| AT-09 | Tuning uses the saved Planning intelligence profile. |
| AT-10 | Tuning independently executes acceptance verification. |
| AT-11 | Tuning can create rework tasks and return them to Development. |
| AT-12 | The maximum rework cycle count is enforced. |
| AT-13 | Final Tuning fixes trigger appropriate revalidation. |
| AT-14 | Ready for Review requires all mandatory acceptance gates. |
| AT-15 | The four-light UI reflects actual JSON task progress. |
| AT-16 | Stage indicators open the appropriate Agent inspector. |
| AT-17 | Background Agent inspection does not create permanent Tabs. |
| AT-18 | UI changes to maximum rework cycles are validated and persisted. |
| AT-19 | Interrupted workflows resume without duplicate task dispatch. |
| AT-20 | Different repositories and worktrees remain isolated. |
| AT-21 | Blocked Agents and timeouts never produce false success. |
| AT-22 | User-owned terminals and pre-existing Git changes are preserved. |

Validate the native Mod using the installed version's official check command, such as:

```bash
herdr-app check <mod-folder>
```

Run the actual Herdr App and capture UI screenshots using the supported screenshot command.

Perform end-to-end workflow tests in a disposable Git repository or isolated worktree before using production code.

Do not execute destructive test cases against real user projects.

## 12. Definition of Done

The implementation is complete only when:

- All three Skills are operational.
- Workflow State survives Agent session termination.
- The lightweight Runner coordinates all transitions.
- Background Agents do not create regular Herdr Tabs.
- Development uses a single sequential Worker.
- The Tuning model matches the Planning intelligence profile.
- Rework and final tuning behave correctly.
- The four-light UI displays real workflow progress.
- Ready for Review is reached only after successful validation.
- All mandatory acceptance tests have been executed and passed.

If any acceptance test fails or cannot be executed, document the limitation clearly.

Do not claim full completion based on source code inspection or mock tests alone.

## 13. Execution Instructions

Proceed autonomously with implementation.

Follow this order:

1. Inspect the installed environment and official documentation.
2. Determine the minimal project structure.
3. Implement the JSON State Helper.
4. Implement the Workflow Runner.
5. Implement and install the three Skills.
6. Verify background OpenCode execution and cleanup.
7. Validate Planning → Development → Tuning handoff.
8. Implement bounded rework and Ready for Review.
9. Implement the native Herdr four-light UI.
10. Install and validate the Mod.
11. Run automated and real end-to-end acceptance tests.
12. Produce a concise implementation report.

Do not stop after writing a plan.

Do not introduce unnecessary frameworks.

Make reasonable engineering decisions where requirements are already clear.

If a capability is unsupported by the installed Herdr version, document the evidence and implement the smallest safe compatible alternative.

At completion, report:

- Files created or changed.
- Skills installed.
- Herdr Mod installation path.
- Runner execution method.
- Verified CLI and model configuration.
- Acceptance test results.
- Known limitations.
- How to start, inspect, pause, and resume the workflow.

**Engineering Principle: Three Skills. One deterministic Runner. One persistent state. One background Worker. Four status lights. Zero unnecessary Herdr Tabs.**
