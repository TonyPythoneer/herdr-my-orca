---
name: orca-ui
description: Find existing UI and native capabilities, then make and verify a change under the binding repository architecture.
---

# Orca UI workflow

Read AGENTS.md and docs/naming.md. They are binding. Search using the existing source-derived discovery CLI before editing:
```sh
node scripts/ui.mjs find <control>
node scripts/ui.mjs outline <mod> --ui
node scripts/ui.mjs where <id>
node scripts/ui.mjs pages
```
Verify the actual current CLI and source mapping. Reuse verified native GPUI/Herdr capabilities and existing primitives first. Use the canonical responsibility layers and semantic ID syntax; do not add legacy catch-all paths or edit generated JS. During migration, report unsupported build/source mappings instead of inventing a compiler or changing delivery contracts.

Run relevant source checks, tests and build using the actual current package/toolchain. Verify isolated native load with herdr-app check where available; verify the actual page and interactions with open/tree/shot/click. No DOM; tree is OCR/geometry. A locked or unavailable desktop is a reported blocker, not a passing test. Update discovery and tests with all changed IDs. Follow the live-sync skill only for authorized and verified delivery. Do not deploy an unverified migration.
