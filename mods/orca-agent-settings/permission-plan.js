// What a permission change does and says, as pure functions of the rows: no herdr or gpui imports.
import { PERMISSION_LABELS, permissionChoices, withPermission } from "./permissions.js";
import { sameRun } from "./util.js";

/**
 * The top-level choice applied to every managed row: the new `run` of each agent that takes it
 * (`runs`), how many took it, how many cannot express it, and how many keep custom launch flags.
 */
export function planDefaultPermission(rows, choice) {
  const plan = { runs: new Map(), applied: 0, unsupported: 0, custom: rows.filter((row) => row.permission === "custom").length };
  for (const row of rows) {
    if (row.permission === "custom") continue;
    const next = (permissionChoices(row.key) ?? []).includes(choice) ? withPermission(row.key, row.run, choice) : null;
    if (!next) {
      plan.unsupported += 1;
      continue;
    }
    plan.applied += 1;
    if (!sameRun(next, row.run)) plan.runs.set(row.key, next);
  }
  return plan;
}

/** The one-line notice after a top-level choice. */
export function defaultPermissionNotice({ applied, unsupported, custom }) {
  const notes = [`Applied to ${applied} agent${applied === 1 ? "" : "s"}`];
  if (unsupported > 0) notes.push(`${unsupported} don't support this setting`);
  if (custom > 0) notes.push(`${custom} ${custom === 1 ? "uses" : "use"} custom launch arguments`);
  return `${notes.join("; ")}.`;
}

// Names listed in a summary line before the rest become "+N".
const SUMMARY_NAMES = 3;

/**
 * The lines under the all-agents choice: the agents that keep their own permission, the agents
 * with no flag for the choice, and the agents whose own command sets flags. A line is null when
 * there is nothing to say.
 */
export function permissionSummary(managed, permissions) {
  const exceptions = managed.filter((row) => row.permissionOverride);
  const custom = managed.filter((row) => row.permission === "custom");
  const noChoice = managed.filter((row) => !(permissionChoices(row.key) ?? []).includes(permissions.default));
  return {
    exceptions: exceptions.length,
    custom: custom.length,
    exceptionLine: exceptions.length ? exceptionText(exceptions) : null,
    customLine: custom.length ? customText(custom.length) : null,
    noChoiceLine: permissions.default !== "own" && noChoice.length > 0 ? noChoiceText(noChoice, permissions.default) : null,
  };
}

function exceptionText(exceptions) {
  const lead = exceptions.length === 1 ? "1 agent keeps its" : `${exceptions.length} agents keep their`;
  return `${lead} own permission: ${exceptions.map((row) => `${row.name} (${PERMISSION_LABELS[row.permission]})`).join(", ")}.`;
}

function customText(count) {
  return `${count === 1 ? "1 agent sets" : `${count} agents set`} permission flags in its own command; changing the default leaves ${count === 1 ? "it" : "them"} alone.`;
}

function noChoiceText(noChoice, choice) {
  const lead = noChoice.length === 1 ? "1 agent has" : `${noChoice.length} agents have`;
  const names = noChoice.slice(0, SUMMARY_NAMES).map((row) => row.name).join(", ");
  const more = noChoice.length > SUMMARY_NAMES ? ` +${noChoice.length - SUMMARY_NAMES}` : "";
  return `${lead} no ${PERMISSION_LABELS[choice]} flag and ${noChoice.length === 1 ? "keeps its" : "keep their"} own command: ${names}${more}.`;
}
