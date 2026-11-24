# Who executed the refactor (CLI + model + effort)

Each batch lists the CLI, model and effort that did the work. Where a batch changed hands because of
usage limits, every executor is named. "default" means the CLI's default effort for that model.

| Batch | Executor(s) |
|---|---|
| shared JS, panel-head, scripts | Claude Code + claude-sonnet-5-5 (default); earlier partial run: codex + gpt-6.2-astra (high) |
| orca-agent-manager | Claude Code + claude-sonnet-5-5 (default); earlier partial run: codex + gpt-6.2-astra (high) |
| orca-changes, orca-worktree, orca-handoff | Claude Code + claude-sonnet-5-5 (default); earlier partial run: codex + gpt-6.2-astra (medium) |
| agent-config, orca-new-menu, orca-split-menu, orca-menu | Claude Code + claude-sonnet-5-5 (default); earlier partial run: codex + gpt-6.2-astra (medium) |
| orca-status, orca-tasks, orca-chrome, orca-agents, orca-panel-gap | Claude Code + claude-sonnet-5-5 (default); earlier partial run: codex + gpt-6.2-astra (medium) |
| orca-files, orca-diff, orca-confirm | Claude Code + claude-sonnet-5-5 (default); earlier partial run: codex + gpt-6.2-astra (high) |
| orca-tabs, orca-pane, orca-float, orca-landing | Claude Code + claude-sonnet-5-5 (default); earlier partial run: codex + gpt-6.2-astra (high) |
| orca-spaces, orca-nav | Claude Code + claude-sonnet-5-5 (default); earlier partial run: codex + gpt-6.2-astra (high) |
| skillshare (partial, 12 lint left) | opencode + deepseek-v4.1-flash-free (low) for the last pass; Claude Code + claude-sonnet-5-5 and codex + gpt-6.2-astra (high) before |
| orchestration, CI, metrics, merges | Claude Code + claude-sonnet-5-5 |
