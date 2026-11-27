# Vite+ migration — staged delivery contract

Base: `fix/sidebar-branch-tooltip` at `6dd7b2c`. This is separate from the ongoing shared-component refactor. Do not merge this migration into main before that parent branch lands or is explicitly reconciled.

## Stage 0 (this change): isolated executable candidate
- Exact Vite+ 1.8.0 (includes tsrs); Node 24, existing production build/tests/lint untouched.
- `tools/vite-plus-pilot/src/list-viewport.ts` is an experiment, NOT a second authoritative source. The legacy JS remains canonical until the cutover. It is deliberately a pure helper used by multiple mods.
- From the pilot directory: `npm install`, `npm run check`, `node verify-type-check.mjs`, `npm run test`, `npm run pack`, `npm run parity`, `node compare-lint.mjs`.
- Initial install is an experiment with a pinned direct dependency, not a reproducible production install. Capture the resolved lockfile, review the dependency tree and commit the lockfile before adopting the toolchain in required CI. No independent Oxlint/tsrs/tsdown versions.
- Compare lint diagnostics by file/rule/location, including suppression and rule options, not just totals. Existing ESLint remains authoritative; collect cold/warm timing with identical scope and report install separately.
- The negative type probe must fail with the expected assignment diagnostic, not just a nonzero exit code. Pack must generate a usable ESM .js file and match all existing manifest copies' behavior.
- No live Herdr writes, no changes to tracked mods or existing workflow gates in this stage.

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
