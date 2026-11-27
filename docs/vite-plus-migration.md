# Vite+ migration — staged delivery contract

Base: `fix/sidebar-branch-tooltip` at `6dd7b2c`. This is separate from the ongoing shared-component refactor. Do not merge this migration into main before that parent branch lands or is explicitly reconciled.

All stages are mandatory in **PR #32**. Do not create follow-up PRs or mark ready until the cutover gates are satisfied.

## Stage 0: isolated executable candidate
- Exact Vite+ 1.8.0 (includes tsrs); Node 24, existing production build/tests/lint untouched.
- `tools/vite-plus-pilot/src/list-viewport.ts` is an experiment, NOT a second authoritative source. The legacy JS remains canonical until the cutover. It is deliberately a pure helper used by multiple mods.
- From the repository root: `npm install`, `npm run check:pilot`, `node tools/vite-plus-pilot/verify-type-check.mjs`, `npm run test:pilot`, `npm run pack:pilot`, `node tools/vite-plus-pilot/verify-output.mjs`, `npm run compare:lint`, `npm run pack:delivery:candidate`. The pinned toolchain now lives in the root package and `vite.config.ts`.
- The root lockfile was captured from successful Linux CI (153 package records, public npm registry) and committed. Required CI and candidate CI use npm ci. No independent Oxlint/tsrs/tsdown versions.
- Compare lint diagnostics by file/rule/location, including suppression and rule options, not just totals. Initial exact parity was verified at file/rule/line level (20 findings on both tools); production quality checks use Vite+ while the legacy config remains only for migration comparisons. Collect cold/warm timing with identical scope and report install separately.
- The negative type probe must fail with the expected assignment diagnostic, not just a nonzero exit code. Pack must generate a usable ESM .js file and match all existing manifest copies' behavior.
- No live Herdr writes, no changes to tracked mods or existing workflow gates in this stage.

## Full installation build candidate
The all-JS repack experiment failed behavior parity: parent and source each had 34 identical failing names; packed had 82 failures (52 new, 4 parent failures masked). Native load alone was insufficient. The underlying issue is unnecessary reprinting of existing JS by the bundler (export form, import order/aliases, comments and source lines); source-based VM fixtures, generated-copy checks, and error mapping depend on those forms. Do not normalize goldens to make this pass.

The revised hybrid build compiles the typed pilot once with `vp pack`, fans out identical compiled bytes to its three manifest consumers, and preserves every other tracked install file byte-for-byte after the legacy drift check. Existing JS needs no transpilation. Source and packed worktrees both run the entire test inventory; two legacy generated-byte assertions select compiler output for the typed copies only in packed mode, while the source tree still checks legacy source bytes and drift. Direct runtime export/behavior checks cover all three compiled copies. The tested PR merge's first parent is used for the baseline, with head verification. No live config writes. This is a migration bridge, not the final canonical TS/source-only cutover.

## Stage 1: lint and quality reporting
Map all 17 current ESLint rules and suppression semantics; compare diagnostics; adapt metrics.mjs JSON parsing and baseline schema with tests; preserve complexity thresholds and scope. Install pinned Vite+ with committed lockfile in CI, measure cold/warm setup and execution. Switch required CI only after parity; keep Node tests and full process routing. Revert the switch if the candidate drops findings or breaks report generation.

## Stage 2: typed sources and build
Prefer actual host declarations: herdr-app check/gpui-shell already writes gpui-kit.d.ts and jsconfig.json per the repo gitignore. Inspect generated declarations and upstream contracts; don't replace them with broad any declarations. Verify gpui-kit/gpui-base/herdr remain external, module format, per-mod import isolation, file permissions, source-map lookup, scripts/assets/JSON, deterministic output, manifest fan-out, and no unintended deletion. Migrate one feature at a time and compare both strict and semantic UI goldens and failing-test names using docs/handoff.md. Do not silently re-record goldens. Preserve existing native checks, scripts/ui-index.mjs discovery, sync tooling, coverage, and CI impact routing; extend for ts/mts. Keep pack output in a staging directory, never use clean:true against live or mixed-source mods.

## Stage 3: source-only repository and delivery
Move every handwritten mod source, resource, test and manifest to canonical orca-ui source (or an agreed unified tree). Prove fresh clone builds a complete installable payload and existing-install upgrades preserve user state (data/, shared.json, etc.). Test native Herdr load, UI interactions, benchmarks and rollback to previous release. Only then ignore /mods/ and untrack generated files; publish prebuilt release artifacts with layouts, settings, themes, assets and mods, and update installation docs. Preserve compatibility for direct-copy users via release artifacts. Do not use a broad delete/sync against live config.

## Cutover gates
- No unexplained lint or type-check regression, zero type errors in migrated modules; no new any/ts-ignore escapes.
- Full tests, native load, relevant visual/interaction checks, and performance checks meet existing baselines.
- Pack output path/permissions/assets/imports/fan-out and clean-clone install verified; release/rollback documented.
- Preserve legacy production path until these gates are independently reviewed. No auto-merge.
