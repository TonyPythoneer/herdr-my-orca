# AGENTS.md

## Binding architecture contract

MUST and MUST NOT are absolute repository requirements (BCP 14). Agents MUST NOT waive, bypass, weaken or silently reinterpret them to finish a task or pass CI. Maintainer approval is REQUIRED for any exception; document scope and rationale. Report blockers instead of violating the contract.

- Optimize for the minimum context necessary for a **correct** change; correctness, security, reliability and native compatibility are mandatory.
- Code MUST be self-explanatory. Use precise names, types and cohesive boundaries. MUST NOT add explanatory source comments; retain required legal notices, tooling directives and generated metadata. No redundant wrappers, speculative abstractions, arbitrary file-per-part splitting or unnecessary layers.
- Canonical TypeScript responsibilities: `src/primitives/` (business-agnostic UI and intrinsic interactions), `components/` (product UI), `composables/` (reusable stateful coordination), `services/` (business operations and I/O), `config/` (static settings and definitions), `mods/` (native integration), `tooling/` (development/validation). Stores are optional and require actual shared runtime state. MUST NOT add new generic shared/features/containers/common/helpers/misc/utils catch-all directories.
- Primitives MUST NOT depend on product logic or business services. Composables MUST NOT render UI or import product components. Services MUST NOT render UI or own view state. Config MUST NOT import implementation. Runtime MUST NOT depend on tooling. No circular dependencies, duplicated implementation, global event bus or gratuitous shared mutable state.
- Every project-owned identifier MUST describe its actual role. Use Base UI/Radix anatomy and Tailwind-inspired property/state vocabulary; classify by behavior, not visual resemblance. Components/types PascalCase, functions/state camelCase, filenames kebab-case; useX only for genuinely composable logic. See [naming](docs/naming.md) for vocabulary.
- UI IDs MUST use `scope--semantic-identifier[-stable-target-identity]`. Stable identity, not array index or translated label. Interactive controls MUST have stable IDs and accessible labels using supported native APIs. Independent actions MUST stay independent. Preserve external host and persisted contracts; migrate project-owned IDs with all consumers.
- Static reusable settings MUST have a single semantic owner in `config/ui-settings/`, `config/system-settings/` or `config/definitions/`; primitive settings in `ui-settings/primitives/`. Use `COMPONENT__PROPERTY_UNIT` and explicit units where relevant. Preserve values, except explicitly approved changes. Do not extract derived, protocol or algorithm-local values indiscriminately, merge unrelated equal literals, duplicate native JSON, or put secrets/live state/user overrides in static config.
- Native first: MUST inspect pinned Herdr/GPUI/gpui-kit/gpui-base and existing project implementations before creating UI, icons, events or integration. Reuse equivalent native capability, then existing implementation, then compose native elements; custom implementation requires a documented missing capability. MUST NOT hand-draw duplicate generic icons, add redundant bridges, or wrap native APIs just to rename them. Preserve brand logos and licensing.
- Preserve native event names/signatures. Raw handlers handleClick/handleMouseDown/handleHoverChange; public callbacks onSelect/onValueChange/onOpenChange; business actions selectAgent/closeTab. Distinguish visual hover from state, click from press/release, wheel from scroll position, selected from hovered/focused/highlighted. Preserve ordering, propagation, nested actions, keyboard equivalents, cancellation and cleanup. Reuse only genuinely common behavior; no global dispatcher.
- Build target: independent native mod bundles using only Vite+ native bundling/tree shaking/inlining; MUST NOT edit generated JS or add custom compiler rewrites, global defines, post-build substitutions or runtime cross-mod/config imports. Do not claim native build verification without evidence.

## Migration status and scope

[#38](https://github.com/TonyPythoneer/herdr-my-orca/issues/38) owns architecture, configuration, naming and discovery. [#37](https://github.com/TonyPythoneer/herdr-my-orca/issues/37), #34 and #35 own build readiness, branch distribution and toolchain work. The current checkout still contains legacy manifests, source paths and generated/handwritten JS; those are existing migration debt, not permission to expand it. The approved target above is binding for new work. Do not remove legacy runtime paths or claim the final distribution contract until the actual build is verified. Do not edit generated copies. Report blockers rather than inventing an alternate build pipeline.

## Discovery first

Read the applicable skills: `.agents/skills/orca-ui/SKILL.md` and `.agents/skills/herdr-app-always-goes-live/SKILL.md` (only sync live when authorized and available).

| Need | Existing discovery |
|---|---|
| Find reusable UI | `node scripts/ui.mjs find button` |
| Locate exact control | `node scripts/ui.mjs where <id>` |
| Inspect mod | `node scripts/ui.mjs outline <mod>` |
| Layout mounts | `node scripts/ui.mjs pages` |
| Running app | `node scripts/ui.mjs tree --map` |

Use discovery before editing; read relevant cohesive source and dependencies. The index is source-derived; update maps/tests/skills/docs with renames. Check the actual current package.json and CI before running commands. Legacy command examples are not authority for future toolchain changes. No DOM: native tree mapping is OCR/geometry, can collide with text, and live input requires an eligible unlocked desktop. Never invent native capability or command.

## Completion gate

MUST verify relevant dependency/naming/config/ID/native-reuse rules, type checking, tests, build and actual native UI behavior where possible. Use existing narrow checks, not an unrelated compiler or heavy routine benchmark. MUST report exact commands/results, unverified behavior and remaining work; MUST NOT claim completion when required verification is missing. Preserve the approved before/after AI readability benchmark outside routine CI. No unrelated scope expansion, unauthorized publication or merge.
