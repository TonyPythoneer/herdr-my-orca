// What the agent setup flyout is made of, as data: one SPEC per agent (its options, the CLI argument
// each one becomes, the sections they sit in) and the few pure functions that read a spec. The
// flyout (orca-agent-flyout) draws any spec with one renderer per option type, and the new-menu asks
// `hasFlyout` which rows get a chevron, so adding an agent is a spec here plus a parser if its model
// list has a new shape. Nothing in a spec is code: it survives JSON.stringify.
//
// Option types (each drawn once, in orca-agent-flyout):
//   model     the model select and its list; `groups` adds a SHOW filter, models can be hidden
//   effort    the select that follows the model, from the chosen model's own `efforts`
//   select    a select over `choices` (or a hooked list, `source`)
//   checklist ticked items, each a flag or a hooked expansion
//   editor    a text editor with a manual Save (`language: "json"` also validates)
//   toggle    an on/off flag, its argv added when on
//   provider  the model source select (its launch is a hook)
//
// Argument templates are argv elements: `{v}` is the option's value, `{id}` a checklist item's id,
// and `{ json: <template> }` is JSON.stringify of the template with those substituted.
//
// Pure: no herdr or gpui imports, so `node --test` runs it directly. Edit this file, then
// `node scripts/build-orca-ui.mjs --out .` writes the copies the mods import.

export const DEFAULT_AGENTS = {
  scout: {
    description: "Research repository and documentation",
    model: "haiku",
    tools: ["Read", "Grep", "Glob"],
    prompt: "Investigate the codebase. Return concise findings. Do not modify files.",
  },
  checker: {
    description: "Review significant code changes",
    model: "opus",
    tools: ["Read", "Grep", "Glob"],
    prompt: "Review changes for correctness, bugs, and risks. Do not modify files.",
  },
};

// Stored exactly as the editor shows it: two spaces, no trailing spaces.
export const DEFAULT_AGENTS_TEXT = JSON.stringify(DEFAULT_AGENTS, null, 2);

export const DEFAULT_PROMPT = [
  "You are the primary implementation agent.",
  "",
  "Delegate research to scout.",
  "Write and test code yourself.",
  "Ask checker to review significant changes.",
  "",
  "Consult the advisor:",
  "1. Before finalizing complex plans.",
  "2. When the same error occurs twice.",
  "3. Before declaring complex work complete.",
  "",
  "Before finishing, verify the change by running checks on the edge cases that matter for it. Then reply with only: your answer, the one or two checks that best prove it, anything that failed or remains risky, and decisions only a human can make. Leave out the rest of your process.",
].join("\n");

// Codex feature flags the launch can switch off with `--disable`. Off by default: nothing changes
// until one is ticked. "mcp" is not a feature flag: `mcp_servers={}` does not clear servers
// (codex#16045), so launch lists them and passes `-c mcp_servers.<name>.enabled=false` for each.
const CODEX_ITEMS = ["plugins", "apps", "remote_plugin", "plugin_sharing", "browser_use", "browser_use_external", "computer_use", "image_generation", "in_app_browser", "skill_search", "skill_mcp_dependency_install"].map((id) => ({
  id,
  argv: ["--disable", "{id}"],
}));

// pi's `--no-*` switches an interactive tab may want off. Each is one flag of `pi --help`.
const PI_ITEMS = [
  { id: "extensions", argv: ["--no-extensions"] },
  { id: "mcp", argv: ["--no-mcp"] },
  { id: "skills", argv: ["--no-skills"] },
  { id: "prompt_templates", argv: ["--no-prompt-templates"] },
  { id: "themes", argv: ["--no-themes"] },
  { id: "context_files", argv: ["--no-context-files"] },
  { id: "session", argv: ["--no-session"] },
  { id: "offline", argv: ["--offline"] },
];

// Levels `pi --thinking` takes; a model that does not think takes none.
export const PI_THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export const SPECS = {
  claude: {
    label: "Claude",
    command: "claude",
    // Claude has no model list command. Its stream-json `initialize` control request answers with
    // the live models (`value` is what --model takes, `supportedEffortLevels` what --effort takes).
    models: {
      shell: `printf '%s\\n' '{"type":"control_request","request_id":"orca-agent-flyout","request":{"subtype":"initialize"}}' | claude -p --input-format stream-json --output-format stream-json --verbose`,
      parser: "claudeInitialize",
    },
    options: {
      provider: { type: "provider", label: "MODEL SOURCE" },
      model: { type: "model", label: "MODEL", argv: ["--model", "{v}"] },
      effort: { type: "effort", label: "EFFORT", argv: ["--effort", "{v}"], omit: [""] },
      fast: { type: "toggle", label: "FAST", argv: ["--fast"], default: false },
      advisorModel: { type: "select", label: "ADVISOR", choices: ["none", "opus", "haiku", "fable", "sonnet"], default: "opus", argv: ["--advisor", "{v}"], omit: ["none"] },
      outputStyle: { type: "select", label: "OUTPUT STYLE", source: "claudeOutputStyles", default: "default", argv: ["--settings", { json: { outputStyle: "{v}" } }], omit: ["default"] },
      agents: { type: "editor", label: "Agents", language: "json", default: DEFAULT_AGENTS_TEXT, argv: ["--agents", "{v}"] },
      systemPrompt: { type: "editor", label: "Append system prompt", default: DEFAULT_PROMPT, argv: ["--append-system-prompt", "{v}"] },
    },
    launch: ["model", "effort", "fast", "advisorModel", "outputStyle", "agents", "systemPrompt"],
    ui: {
      sections: [
        { title: "HARNESS CLI ARGUMENTS", options: ["provider", "model", "effort", "fast"], gap: 4 },
        { title: "HARNESS CLI ADVANCED ARGUMENTS", options: ["advisorModel", "outputStyle", "agents", "systemPrompt"] },
      ],
      rows: [["provider", "model"], ["effort", "fast"], ["advisorModel", "outputStyle"]],
      reset: true,
    },
  },
  codex: {
    label: "Codex",
    command: "codex",
    // `codex debug models` prints the catalog as JSON: its visible models and each one's efforts.
    models: { shell: "codex debug models", parser: "codexCatalog" },
    options: {
      provider: { type: "provider", label: "MODEL SOURCE" },
      model: { type: "model", label: "MODEL", argv: ["-m", "{v}"] },
      effort: { type: "effort", label: "EFFORT", argv: ["-c", "model_reasoning_effort={v}"], omit: ["", null] },
      fast: { type: "toggle", label: "FAST", argv: ["--fast"], default: false },
      codexOff: { type: "checklist", label: "DISABLE", bulk: true, items: [...CODEX_ITEMS, { id: "mcp", expand: "codexMcp" }] },
    },
    launch: ["model", "effort", "fast", "codexOff"],
    ui: {
      sections: [
        { title: "HARNESS CLI ARGUMENTS", options: ["provider", "model", "effort", "fast"], gap: 4 },
        { title: "HARNESS CLI ADVANCED ARGUMENTS", options: ["codexOff"] },
      ],
      rows: [["effort", "fast"]],
    },
  },
  opencode: {
    label: "OpenCode",
    command: "opencode",
    // `opencode api GET /api/model` returns the live catalog. Keep the opencode provider and omlx
    // (local MLX models); ollama is left out. Which opencode models are free is remembered: the
    // catalog does not reflect payment, so an unpaid account still sees paid models.
    models: { shell: "opencode api GET /api/model", parser: "opencodeCatalog" },
    options: {
      provider: { type: "provider", label: "MODEL SOURCE" },
      model: {
        type: "model",
        label: "MODEL",
        // opencode mixes cloud models (free/paid) and local omlx models; the list shows one group.
        groups: [
          { id: "all", label: "All" },
          { id: "free", label: "Free" },
          { id: "paid", label: "Paid" },
          { id: "omlx", label: "OMLX" },
        ],
        group: "free", // a paid model just answers 402, so the list starts on free
      },
      effort: { type: "effort", label: "EFFORT" },
      fast: { type: "toggle", label: "FAST", argv: ["--fast"], default: false },
    },
    launch: ["model", "effort", "fast"],
    // The TUI takes no --model flag: the model goes in through its config env var, and it must run
    // its own server (--standalone), since the background service keeps its own config and a TUI
    // that connects to it ignores OPENCODE_CONFIG_CONTENT. Its effort is its own state file.
    wrap: { env: { OPENCODE_CONFIG_CONTENT: { json: { model: "{model}" } } }, suffix: ["--standalone"], after: "opencodeVariant" },
    ui: {
      sections: [
        { title: "HARNESS CLI ARGUMENTS", options: ["provider", "model", "effort", "fast"], gap: 4 },
      ],
      rows: [["effort", "fast"]],
    },
  },
  pi: {
    label: "Pi",
    command: "pi",
    // `pi --list-models` prints a table: provider, model, context, max-out, thinking, images.
    // `default` adds a first entry that passes no --model, so a plain click starts pi on its own model
    // (and still starts it when the list is empty, e.g. nothing is logged in yet).
    models: { shell: "pi --list-models", parser: "piTable", default: "Default" },
    options: {
      provider: { type: "provider", label: "MODEL SOURCE" },
      model: { type: "model", label: "MODEL", argv: ["--model", "{v}"] },
      effort: { type: "effort", label: "THINKING", argv: ["--thinking", "{v}"], omit: [""] },
      fast: { type: "toggle", label: "FAST", argv: ["--fast"], default: false },
      off: { type: "checklist", label: "TURN OFF", bulk: true, items: PI_ITEMS },
      systemPrompt: { type: "editor", label: "Append system prompt", default: "", argv: ["--append-system-prompt", "{v}"] },
    },
    launch: ["model", "effort", "fast", "off", "systemPrompt"],
    ui: {
      sections: [
        { title: "HARNESS CLI ARGUMENTS", options: ["provider", "model", "effort", "fast"], gap: 4 },
        { title: "HARNESS CLI ADVANCED ARGUMENTS", options: ["off", "systemPrompt"] },
      ],
      rows: [["effort", "fast"]],
    },
  },
};

export const hasFlyout = (key) => Object.hasOwn(SPECS, key);

/** The sections a spec draws, top to bottom: its own, or the shared ARGUMENTS / ADVANCED pair. `gap` is the space between a section's controls (8 when absent). */
export function sectionsOf(spec) {
  if (spec.ui?.sections) return spec.ui.sections;
  const ids = Object.keys(spec.options);
  const head = ids.filter((id) => spec.options[id].type === "model" || spec.options[id].type === "effort");
  const rest = ids.filter((id) => !head.includes(id));
  return [
    { title: "HARNESS CLI ARGUMENTS", options: head, gap: 4 },
    ...(rest.length ? [{ title: "HARNESS CLI ADVANCED ARGUMENTS", options: rest }] : []),
  ];
}

const fill = (template, vars) => {
  if (typeof template === "string") return template.replace(/\{(\w+)\}/g, (_m, name) => String(vars[name] ?? ""));
  if (Array.isArray(template)) return template.map((part) => fill(part, vars));
  if (template && typeof template === "object") {
    if ("json" in template) return JSON.stringify(fill(template.json, vars));
    return Object.fromEntries(Object.entries(template).map(([key, part]) => [key, fill(part, vars)]));
  }
  return template;
};

const blank = (value) => value === undefined || value === null || (typeof value === "string" && value.trim() === "");

/**
 * The arguments one option adds. A select or model adds its `argv` with `{v}` filled in; an editor
 * adds it unless its text is blank; a checklist adds each ticked item's argv in item order, and an
 * item with `expand` takes its arguments from `expansions[expand]` (a hook's answer). `omit` lists
 * values that add nothing.
 */
export function optionArgs(option, value, expansions = {}) {
  if (option.type === "checklist") {
    const on = new Set(value ?? []);
    return option.items.flatMap((item) => {
      if (!on.has(item.id)) return [];
      if (item.expand) return expansions[item.expand] ?? [];
      return fill(item.argv ?? [], { id: item.id });
    });
  }
  if (option.type === "toggle") return value ? fill(option.argv, { v: value }) : [];
  if (!option.argv || blank(value) || (option.omit ?? []).includes(value)) return [];
  return fill(option.argv, { v: value });
}

/**
 * The argv a launch runs: `base` (the program and what programs.json adds), then each launch option's
 * arguments in launch order. `skip` leaves options out (a provider launch has its own model and no
 * effort). A spec with `wrap` runs through `env` and a suffix instead, like opencode.
 */
export function buildArgv(spec, base, values, { expansions = {}, skip = [] } = {}) {
  const args = spec.launch.filter((id) => !skip.includes(id)).flatMap((id) => optionArgs(spec.options[id], values[id], expansions));
  if (!spec.wrap) return [...base, ...args];
  const env = Object.entries(spec.wrap.env ?? {}).map(([name, template]) => `${name}=${fill(template, { model: values.model })}`);
  return ["env", ...env, ...base, ...args, ...(spec.wrap.suffix ?? [])];
}

// ---- what is saved ------------------------------------------------------------------------------
// agent-config.json keeps, per agent: `model`, `effort`, `hidden`, `group` at the top and every other
// option under `preset`, by option id. These keys are the ones saved before the specs existed, so
// nothing is migrated; the few old spellings are read here.

const TOP = ["model", "effort"];

/** The values a spec starts with, before anything is saved. */
export function defaultValues(spec) {
  const values = {};
  for (const [id, option] of Object.entries(spec.options)) {
    if (option.type === "checklist") values[id] = [];
    else if (option.type === "toggle") values[id] = option.default ?? false;
    else if (option.type === "editor" || option.type === "select") values[id] = option.default ?? "";
  }
  return values;
}

/** Saved settings of one agent to option values. Unknown and malformed entries fall back to defaults. */
export function readValues(spec, saved = {}) {
  const values = defaultValues(spec);
  const preset = saved.preset ?? {};
  for (const [id, option] of Object.entries(spec.options)) {
    if (TOP.includes(id)) {
      if (typeof saved[id] === "string") values[id] = saved[id];
    }
    else if (option.type === "checklist") values[id] = readChecklist(option, preset[id]);
    else if (option.type === "toggle") values[id] = preset[id] === true;
    else if (option.type === "select") values[id] = readSelect(id, option, preset, values[id]);
    else if (option.type === "editor") values[id] = readText(preset[id], values[id]);
  }
  return values;
}

// A saved editor text: any string, even an empty one; anything else keeps the default.
const readText = (stored, fallback) => (typeof stored === "string" ? stored : fallback);

// Ticked ids that still exist, in the saved order.
function readChecklist(option, stored) {
  const known = new Set(option.items.map((item) => item.id));
  return Array.isArray(stored) ? stored.filter((item) => known.has(item)) : [];
}

function readSelect(id, option, preset, fallback) {
  // The old on/off advisor switch saved `advisor: false`, which is now "none".
  if (id === "advisorModel" && preset.advisor === false) return "none";
  const stored = preset[id];
  const isKept = option.choices?.includes(stored) || (option.source && typeof stored === "string");
  return isKept ? stored : fallback;
}

/** The `preset` object to save for an agent: every non-top option, by id. */
export function presetOf(spec, values) {
  return Object.fromEntries(
    Object.entries(spec.options)
      .filter(([id, option]) => !TOP.includes(id) && ["select", "checklist", "editor", "toggle"].includes(option.type))
      .filter(([id]) => values[id] !== undefined)
      .map(([id, option]) => [id, option.type === "checklist" ? [...(values[id] ?? [])] : values[id]]),
  );
}

/** The opencode group a saved agent shows: its `group`, or the old "only free" switch. */
export function readGroup(option, saved = {}) {
  const groups = option.groups ?? [];
  if (groups.some((g) => g.id === saved.group)) return saved.group;
  return saved.onlyFree === false ? "all" : option.group;
}

// ---- model lists --------------------------------------------------------------------------------
// One parser per shape of CLI output. Each takes stdout and returns the models the flyout lists:
// `{ id, label, efforts, fallbackEffort, group? }`. They are tested against captured output.

// opencode mixes cloud models (free or paid) and local omlx ones; the list shows one group at a time.
function catalogGroup(model, free) {
  if (model.providerID === "omlx") return "omlx";
  return free ? "free" : "paid";
}

// The level a model reports no default for: the one every CLI here accepts.
const DEFAULT_FALLBACK_EFFORT = "high";

const jsonObject = (stdout) => JSON.parse(stdout.slice(stdout.indexOf("{"), stdout.lastIndexOf("}") + 1));

export const PARSERS = {
  claudeInitialize(stdout) {
    for (const line of stdout.split("\n")) {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.type !== "control_response") continue;
      return (message.response?.response?.models ?? []).map((m) => ({
        id: m.value,
        label: m.displayName,
        efforts: m.supportedEffortLevels ?? [],
        fallbackEffort: DEFAULT_FALLBACK_EFFORT,
      }));
    }
    throw new Error("claude did not list its models");
  },

  codexCatalog(stdout) {
    return (jsonObject(stdout).models ?? [])
      .filter((m) => m.visibility === "list")
      .map((m) => ({
        id: m.slug,
        label: m.display_name,
        efforts: m.supported_reasoning_levels.map((r) => r.effort),
        fallbackEffort: m.default_reasoning_level,
      }));
  },

  opencodeCatalog(stdout) {
    return (jsonObject(stdout).data ?? [])
      .filter((m) => m.providerID === "opencode" || m.providerID === "omlx")
      .map((m) => {
        const cost = m.cost ?? [];
        // A free model has no input or output cost on any tier (`big-pickle` is free without a
        // `-free` suffix, so the name is not used).
        const free = cost.length > 0 && cost.every((c) => (c.input ?? 0) === 0 && (c.output ?? 0) === 0);
        return {
          id: `${m.providerID}/${m.modelID ?? m.id}`,
          label: m.name ?? m.modelID ?? m.id,
          group: catalogGroup(m, free),
          // "" first: the model's own level, no variant (opencode's "default").
          efforts: (m.variants ?? []).length ? ["", ...m.variants.map((v) => v.id)] : [],
          fallbackEffort: DEFAULT_FALLBACK_EFFORT,
          free,
        };
      });
  },

  // The columns start where their header words start, so a model name with spaces or dashes stays whole.
  piTable(stdout) {
    const lines = stdout.split("\n").filter((line) => line.trim() !== "");
    const header = lines.findIndex((line) => /^provider\s+model\s/.test(line));
    if (header === -1) return [];
    const at = (word) => lines[header].indexOf(word);
    const [provider, model, context, thinking] = ["provider", "model", "context", "thinking"].map(at);
    const next = lines[header].indexOf("images");
    return lines.slice(header + 1).flatMap((line) => {
      const p = line.slice(provider, model).trim();
      const m = line.slice(model, context).trim();
      if (!p || !m) return [];
      const thinks = line.slice(thinking, next === -1 ? undefined : next).trim() === "yes";
      // "" first: no --thinking, the model's own level.
      return [{ id: `${p}/${m}`, label: m, group: p, efforts: thinks ? ["", ...PI_THINKING] : [], fallbackEffort: "" }];
    });
  },
};

export function parseModels(parser, stdout) {
  const parse = PARSERS[parser];
  if (!parse) throw new Error(`no model parser named ${parser}`);
  return parse(String(stdout ?? ""));
}
// Generated from orca-ui/shared/agent-flyout.js by scripts/build-orca-ui.mjs. Edit that file, not this copy.
