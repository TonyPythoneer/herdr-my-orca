// Pure permission model for the Agent Manager. No herdr or gpui imports: `node --test` runs this
// file directly, and state.js and main.js import it.
//
// A permission is stored as a choice (own, ask, auto, full-access), never as flag text: `run` in
// programs.json is the only thing a launcher reads, and each choice is written into it as a
// recipe. Recipes are argv groups, so removing a choice also removes a flag's value
// (`--permission-mode auto`, `-c approvals_reviewer=user`).

export const PERMISSION_CHOICES = ["own", "ask", "auto", "full-access"];

export const PERMISSION_LABELS = {
  own: "Each agent's own settings",
  ask: "Ask for approval",
  auto: "Approve for me",
  "full-access": "Full access",
  custom: "Custom",
};

export const PERMISSION_SHORT_LABELS = {
  own: "Own",
  ask: "Ask",
  auto: "Approve",
  "full-access": "Full access",
  custom: "Custom",
};

/** One line per choice, as the top-level dropdown shows them. */
export const PERMISSION_DESCRIPTIONS = {
  own: "Every agent uses the permission flags in its own command.",
  ask: "Asks before edits or commands it isn't already allowed to make.",
  auto: "Reviews approval requests for you.",
  "full-access": "Never asks before edits or commands.",
};

// Flag recipes, verified against the installed CLIs (`claude --permission-mode default|auto`,
// `codex --approve-for-me`, `opencode --auto`) and ported from Orca's CLI-checked table for the
// rest. An agent missing from this table has no permission flag to set: it only supports `own`,
// and the page shows no permission row for it.
// shortcut: recipes are a CLI snapshot; re-check the flags when an agent changes its CLI.
const RECIPES = {
  claude: {
    ask: [["--permission-mode", "default"]],
    auto: [["--permission-mode", "auto"]],
    "full-access": [["--dangerously-skip-permissions"]],
  },
  codex: {
    ask: [["-a", "on-request"], ["-s", "read-only"], ["-c", "approvals_reviewer=user"]],
    auto: [["--approve-for-me"]],
    "full-access": [["--dangerously-bypass-approvals-and-sandbox"]],
  },
  opencode: {
    auto: [["--auto"]],
  },
  grok: {
    ask: [["--permission-mode", "default"]],
    "full-access": [["--permission-mode", "bypassPermissions"]],
  },
  // Everything below has a full-access flag and no safe middle: ask and auto are hidden there.
  amp: { "full-access": [["--dangerously-allow-all"]] },
  antigravity: { "full-access": [["--dangerously-skip-permissions"]] },
  copilot: { "full-access": [["--yolo"]] },
  crush: { "full-access": [["--yolo"]] },
  cursor: { "full-access": [["--yolo"]] },
  gemini: { "full-access": [["--yolo"]] },
  hermes: { "full-access": [["--yolo"]] },
  // Kimi's --yolo is "Ask When Needed"; --auto is its Never Ask mode.
  kimi: { "full-access": [["--auto"]] },
  kiro: { "full-access": [["--trust-all-tools"]] },
  qoder: { "full-access": [["--dangerously-skip-permissions"]] },
};

export const PERMISSION_AGENTS = Object.keys(RECIPES);

// Values these flags accept that no recipe writes: seeing one means the command sets its own
// permission policy, so it reads as custom instead of own.
const EXTRA_CARRIERS = {
  claude: ["--permission-mode", "--allow-dangerously-skip-permissions", "--permission-prompt-tool"],
  codex: ["-a", "--ask-for-approval", "-s", "--sandbox"],
  grok: ["--permission-mode", "--always-approve"],
  gemini: ["--approval-mode", "-y"],
  kimi: ["-y", "--yolo", "--yes", "--auto-approve"],
};
// Codex keeps its permission policy in `-c` roots; other `-c` pairs (a model override) are not it.
const CODEX_CONFIG_ROOTS = ["approval_policy", "sandbox_mode", "sandbox_workspace_write"];

const isChoice = (value) => PERMISSION_CHOICES.includes(value);

export function supportsPermissions(key) {
  return Object.prototype.hasOwnProperty.call(RECIPES, key);
}

/** Every choice the agent can express, `own` first; null when it has no permission flag at all. */
export function permissionChoices(key) {
  if (!supportsPermissions(key)) return null;
  const recipes = RECIPES[key];
  return PERMISSION_CHOICES.filter(
    (choice) => choice === "own" || Object.prototype.hasOwnProperty.call(recipes, choice),
  );
}

/** The arguments this choice adds, or null when the agent cannot express it. */
export function permissionArgs(key, choice) {
  if (choice === "own" && supportsPermissions(key)) return [];
  const groups = RECIPES[key]?.[choice];
  return groups ? groups.flat() : null;
}

/** Every known permission group for the agent, whichever choice it belongs to. */
function permissionGroups(key) {
  return Object.values(RECIPES[key] ?? {}).flat();
}

function stripGroups(groups, args) {
  const kept = [];
  for (let index = 0; index < args.length; index += 1) {
    const group = groups.find((candidate) =>
      candidate.every((token, offset) => args[index + offset] === token),
    );
    if (group) {
      index += group.length - 1;
      continue;
    }
    kept.push(args[index]);
  }
  return kept;
}

/** The same command with every known permission flag removed. */
export function stripPermission(key, run) {
  const argv = Array.isArray(run) ? run : [];
  if (!supportsPermissions(key) || argv.length === 0) return [...argv];
  return [argv[0], ...stripGroups(permissionGroups(key), argv.slice(1))];
}

const optionName = (token) => (/^-/.test(token) ? token.split("=", 1)[0] : token);

/** Flags that set a permission policy even when the recipe does not know their value. */
function carrierNames(key) {
  const names = new Set(EXTRA_CARRIERS[key] ?? []);
  for (const token of permissionGroups(key).flat()) {
    if (/^-/.test(token)) names.add(optionName(token));
  }
  return names;
}

/** True when an argument that no recipe accounts for still looks like a permission setting. */
function isCarrier(key, args, index) {
  const token = args[index];
  if (typeof token !== "string" || !/^-/.test(token)) return false;
  const name = optionName(token);
  // Codex carries its policy in `-c` roots; any other `-c` pair (a model override) is not one.
  if (["-c", "--config"].includes(name)) {
    if (key !== "codex") return false;
    const value = token.includes("=") ? token.slice(token.indexOf("=") + 1) : args[index + 1];
    if (typeof value !== "string" || !value.includes("=")) return false;
    const root = value.slice(0, value.indexOf("=")).trim().split(".")[0];
    return CODEX_CONFIG_ROOTS.includes(root);
  }
  return carrierNames(key).has(name);
}

/** The command with this choice's recipe, or null when the agent cannot express it. */
export function withPermission(key, run, choice) {
  const argv = Array.isArray(run) ? run : [];
  const args = permissionArgs(key, choice);
  if (args === null || argv.length === 0) return null;
  return [...stripPermission(key, argv), ...args];
}

/** What this command says about permissions: a known choice, or `custom` when it sets its own. */
export function readPermission(key, run) {
  const argv = Array.isArray(run) ? run : [];
  if (!supportsPermissions(key) || argv.length === 0) return "own";
  const rest = stripPermission(key, argv).slice(1);
  // A permission flag no recipe writes keeps the command custom, so `own` never rewrites it away.
  if (rest.some((_token, index) => isCarrier(key, rest, index))) return "custom";
  for (const choice of permissionChoices(key)) {
    const candidate = withPermission(key, argv, choice);
    if (candidate && candidate.length === argv.length && candidate.every((part, i) => part === argv[i])) {
      return choice;
    }
  }
  return "custom";
}

/** The choice an agent should have: its own override, else the all-agents default. */
export function effectiveChoice(permissions, key) {
  const stored = permissions?.overrides?.[key];
  if (isChoice(stored)) return stored;
  return isChoice(permissions?.default) ? permissions.default : "own";
}

/** A stored `permissions` block, or a reason the file cannot be used as it is. */
export function normalizePermissions(value) {
  if (value === undefined || value === null) return { default: "own", overrides: {} };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { error: "agent-manager.json's `permissions` must be an object." };
  }
  const fallback = value.default ?? "own";
  if (!isChoice(fallback)) {
    return {
      error: `agent-manager.json's \`permissions.default\` must be one of ${PERMISSION_CHOICES.join(", ")}.`,
    };
  }
  const overrides = normalizeOverrides(value.overrides);
  if (overrides.error) return { error: overrides.error };
  return { default: fallback, overrides: overrides.overrides };
}

/** The per-agent choices of a stored `permissions` block, or a reason they cannot be used. */
function normalizeOverrides(stored) {
  if (stored === undefined || stored === null) return { overrides: {} };
  if (typeof stored !== "object" || Array.isArray(stored)) {
    return { error: "agent-manager.json's `permissions.overrides` must be an object." };
  }
  const overrides = {};
  for (const [key, choice] of Object.entries(stored)) {
    if (!isChoice(choice)) {
      return {
        error: `agent-manager.json's \`permissions.overrides.${key}\` must be one of ${PERMISSION_CHOICES.join(", ")}.`,
      };
    }
    overrides[key] = choice;
  }
  return { overrides };
}

/**
 * `run` wins: every managed agent whose command disagrees with the all-agents default is pinned to
 * what its command says, so a later default change cannot silently overwrite it. A custom command
 * carries no choice, so it gets no pin and bulk changes skip it instead.
 */
export function reconcilePermissions(rows, permissions) {
  const base = normalizePermissions(permissions);
  if (base.error) return {};
  const overrides = {};
  for (const row of rows ?? []) {
    if (!row || !supportsPermissions(row.key)) continue;
    const observed = readPermission(row.key, row.run);
    if (observed === "custom" || observed === base.default) continue;
    // An agent that cannot express the all-agents choice and adds no flag chose nothing: it is not
    // an exception the person made, so it does not belong in the override list.
    const choices = permissionChoices(row.key) ?? [];
    if (observed === "own" && !choices.includes(base.default)) continue;
    overrides[row.key] = observed;
  }
  return overrides;
}
