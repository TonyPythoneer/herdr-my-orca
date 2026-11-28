export const PERMISSION_CHOICES = ["own", "ask", "auto", "full-access"] as const;

export type PermissionChoice = (typeof PERMISSION_CHOICES)[number];
export type StoredPermission = PermissionChoice | "custom";

export interface Permissions {
  default: PermissionChoice;
  overrides: Record<string, PermissionChoice>;
}

export type PermissionsResult = Permissions | { error: string };

export const PERMISSION_LABELS: Record<StoredPermission, string> = {
  own: "Each agent's own settings",
  ask: "Ask for approval",
  auto: "Approve for me",
  "full-access": "Full access",
  custom: "Custom",
};

export const PERMISSION_SHORT_LABELS: Record<StoredPermission, string> = {
  own: "Own",
  ask: "Ask",
  auto: "Approve",
  "full-access": "Full access",
  custom: "Custom",
};

export const PERMISSION_DESCRIPTIONS: Partial<Record<PermissionChoice, string>> = {
  own: "Every agent uses the permission flags in its own command.",
  ask: "Asks before edits or commands it isn't already allowed to make.",
  auto: "Reviews approval requests for you.",
  "full-access": "Never asks before edits or commands.",
};

type Recipe = Partial<Record<PermissionChoice, readonly (readonly string[])[]>>;

const RECIPES: Record<string, Recipe> = {
  claude: {
    ask: [["--permission-mode", "default"]],
    auto: [["--permission-mode", "auto"]],
    "full-access": [["--dangerously-skip-permissions"]],
  },
  codex: {
    ask: [
      ["-a", "on-request"],
      ["-s", "read-only"],
      ["-c", "approvals_reviewer=user"],
    ],
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

  amp: { "full-access": [["--dangerously-allow-all"]] },
  antigravity: { "full-access": [["--dangerously-skip-permissions"]] },
  copilot: { "full-access": [["--yolo"]] },
  crush: { "full-access": [["--yolo"]] },
  cursor: { "full-access": [["--yolo"]] },
  gemini: { "full-access": [["--yolo"]] },
  hermes: { "full-access": [["--yolo"]] },

  kimi: { "full-access": [["--auto"]] },
  kiro: { "full-access": [["--trust-all-tools"]] },
  qoder: { "full-access": [["--dangerously-skip-permissions"]] },
};

export const PERMISSION_AGENTS = Object.keys(RECIPES);

const EXTRA_CARRIERS: Record<string, readonly string[]> = {
  claude: ["--permission-mode", "--allow-dangerously-skip-permissions", "--permission-prompt-tool"],
  codex: ["-a", "--ask-for-approval", "-s", "--sandbox"],
  grok: ["--permission-mode", "--always-approve"],
  gemini: ["--approval-mode", "-y"],
  kimi: ["-y", "--yolo", "--yes", "--auto-approve"],
};

const CODEX_CONFIG_ROOTS = ["approval_policy", "sandbox_mode", "sandbox_workspace_write"];

function isChoice(value: unknown): value is PermissionChoice {
  return (PERMISSION_CHOICES as readonly unknown[]).includes(value);
}

export function supportsPermissions(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(RECIPES, key);
}

export function permissionChoices(key: string): PermissionChoice[] | null {
  if (!supportsPermissions(key)) return null;
  const recipes = RECIPES[key];
  return PERMISSION_CHOICES.filter(
    (choice) => choice === "own" || Object.prototype.hasOwnProperty.call(recipes, choice),
  );
}

export function permissionArgs(key: string, choice: StoredPermission): string[] | null {
  if (choice === "own" && supportsPermissions(key)) return [];
  if (choice === "custom") return null;
  const groups = RECIPES[key]?.[choice];
  return groups ? groups.flat() : null;
}

function permissionGroups(key: string): readonly (readonly string[])[] {
  return Object.values(RECIPES[key] ?? {}).flat();
}

function stripGroups(groups: readonly (readonly string[])[], args: readonly string[]): string[] {
  const kept: string[] = [];
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

export function stripPermission(key: string, run: readonly string[] | null | undefined): string[] {
  const argv = Array.isArray(run) ? run : [];
  if (!supportsPermissions(key) || argv.length === 0) return [...argv];
  return [argv[0], ...stripGroups(permissionGroups(key), argv.slice(1))];
}

const optionName = (token: string): string => (/^-/.test(token) ? token.split("=", 1)[0] : token);

function carrierNames(key: string): Set<string> {
  const names = new Set<string>(EXTRA_CARRIERS[key] ?? []);
  for (const token of permissionGroups(key).flat()) {
    if (/^-/.test(token)) names.add(optionName(token));
  }
  return names;
}

function isCarrier(key: string, args: readonly string[], index: number): boolean {
  const token = args[index];
  if (typeof token !== "string" || !/^-/.test(token)) return false;
  const name = optionName(token);

  if (["-c", "--config"].includes(name)) {
    if (key !== "codex") return false;
    const value = token.includes("=") ? token.slice(token.indexOf("=") + 1) : args[index + 1];
    if (typeof value !== "string" || !value.includes("=")) return false;
    const root = value.slice(0, value.indexOf("=")).trim().split(".")[0];
    return CODEX_CONFIG_ROOTS.includes(root);
  }
  return carrierNames(key).has(name);
}

export function withPermission(
  key: string,
  run: readonly string[] | null | undefined,
  choice: StoredPermission,
): string[] | null {
  const argv = Array.isArray(run) ? run : [];
  const args = permissionArgs(key, choice);
  if (args === null || argv.length === 0) return null;
  return [...stripPermission(key, argv), ...args];
}

export function readPermission(
  key: string,
  run: readonly string[] | null | undefined,
): StoredPermission {
  const argv = Array.isArray(run) ? run : [];
  if (!supportsPermissions(key) || argv.length === 0) return "own";
  const rest = stripPermission(key, argv).slice(1);

  if (rest.some((_token, index) => isCarrier(key, rest, index))) return "custom";
  for (const choice of permissionChoices(key) ?? []) {
    const candidate = withPermission(key, argv, choice);
    if (
      candidate &&
      candidate.length === argv.length &&
      candidate.every((part, i) => part === argv[i])
    ) {
      return choice;
    }
  }
  return "custom";
}

export function effectiveChoice(
  permissions: Partial<Permissions> | null | undefined,
  key: string,
): PermissionChoice {
  const stored = permissions?.overrides?.[key];
  if (isChoice(stored)) return stored;
  return isChoice(permissions?.default) ? permissions.default : "own";
}

export function normalizePermissions(value: unknown): PermissionsResult {
  if (value === undefined || value === null) return { default: "own", overrides: {} };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { error: "agent-manager.json's `permissions` must be an object." };
  }
  const stored = value as { default?: unknown; overrides?: unknown };
  const fallback = stored.default ?? "own";
  if (!isChoice(fallback)) {
    return {
      error: `agent-manager.json's \`permissions.default\` must be one of ${PERMISSION_CHOICES.join(", ")}.`,
    };
  }
  const overrides = normalizeOverrides(stored.overrides);
  if ("error" in overrides) return { error: overrides.error };
  return { default: fallback, overrides: overrides.overrides };
}

function normalizeOverrides(
  stored: unknown,
): { overrides: Record<string, PermissionChoice> } | { error: string } {
  if (stored === undefined || stored === null) return { overrides: {} };
  if (typeof stored !== "object" || Array.isArray(stored)) {
    return { error: "agent-manager.json's `permissions.overrides` must be an object." };
  }
  const overrides: Record<string, PermissionChoice> = {};
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

export function reconcilePermissions(
  rows: readonly { key: string; run: readonly string[] }[] | null | undefined,
  permissions: Permissions | undefined,
): Record<string, PermissionChoice> {
  const base = normalizePermissions(permissions);
  if ("error" in base) return {};
  const overrides: Record<string, PermissionChoice> = {};
  for (const row of rows ?? []) {
    if (!row || !supportsPermissions(row.key)) continue;
    const observed = readPermission(row.key, row.run);
    if (observed === "custom" || observed === base.default) continue;

    const choices = permissionChoices(row.key) ?? [];
    if (observed === "own" && !choices.includes(base.default)) continue;
    overrides[row.key] = observed;
  }
  return overrides;
}
