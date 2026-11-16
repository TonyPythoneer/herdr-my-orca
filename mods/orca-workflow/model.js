// Pure model for the workflow UI. Reads my-orca's state.json shape
// (docs/spec-v2-converged.md 4.3) and returns the four lights and inspector rows.
// No Herdr imports, so `node --test mods/orca-workflow` runs without the App.

export const STAGES = [
  { id: "planning", label: "Plan", long: "Planning", color: "#7E66CC" },
  { id: "development", label: "Dev", long: "Development & Testing", color: "#367CE9" },
  { id: "tuning", label: "Tune", long: "Validation & Final Tuning", color: "#C38B35" },
  { id: "ready", label: "Ready", long: "Ready for Review", color: "#139D78" },
];

export function parseJson(text) {
  if (text === null || text === undefined) return null;
  return JSON.parse(text);
}

const accepted = (tasks) => (tasks ?? []).filter((t) => t?.state === "accepted").length;
const passes = (review) => (review?.criteria ?? []).filter((c) => c?.pass === true).length;

export function lights(state) {
  const tasks = Array.isArray(state?.tasks) ? state.tasks : [];
  const acceptance = Array.isArray(state?.acceptance) ? state.acceptance : [];
  const reviews = Array.isArray(state?.reviews) ? state.reviews : [];
  const doneTasks = accepted(tasks);
  const latest = [...reviews].reverse().find((r) => !r?.stale);
  const doneAc = passes(latest);
  const overall = state?.status ?? "working";
  const ready = state?.stage === "ready_for_review" || overall === "completed";

  const out = STAGES.map((s) => ({ ...s, accepted: 0, total: 0, state: "pending" }));
  out[0] = { ...out[0], accepted: 1, total: 1, state: "complete" };
  out[1] = { ...out[1], accepted: doneTasks, total: tasks.length,
    state: ready || (tasks.length > 0 && doneTasks === tasks.length) ? "complete" : tasks.length ? "working" : "pending" };
  out[2] = { ...out[2], accepted: doneAc, total: acceptance.length,
    state: ready || (latest && doneAc === acceptance.length) ? "complete" : (state?.stage === "tuning" || tasks.length) ? "working" : "pending" };
  out[3] = { ...out[3], accepted: ready ? 1 : 0, total: 1, state: ready ? "complete" : "pending" };
  if (overall === "needs_user") {
    const idx = state?.stage === "tuning" ? 2 : state?.stage === "ready_for_review" ? 3 : 1;
    out[idx].state = "needs_user";
  }
  if (overall === "failed") out[1].state = "failed";
  return out;
}

const statusWord = (t) => (typeof t === "string" ? t : t?.state ?? null);

export function workerFor(dispatchId, terminals = []) {
  if (!dispatchId) return null;
  return (terminals ?? []).find((t) => t?.labels?.["orca.dispatch"] === dispatchId) ?? null;
}

export function inspectorRows(state, terminals = []) {
  const tasks = Array.isArray(state?.tasks) ? state.tasks : [];
  const reviews = Array.isArray(state?.reviews) ? state.reviews : [];
  const latest = [...reviews].reverse().find((r) => !r?.stale) ?? null;
  const passById = new Map((latest?.criteria ?? []).map((c) => [c.id, c]));
  const active = state?.dispatch?.id ?? null;
  const activeTask = state?.dispatch?.task ?? null;
  return {
    run_id: state?.run_id ?? null,
    stage: state?.stage ?? null,
    status: state?.status ?? null,
    needs_user: state?.needs_user ?? null,
    planning_closed: state?.planning?.closed ?? null,
    cycles: state?.rework?.cycles ?? 0,
    dispatch: state?.dispatch ?? null,
    tasks: tasks.map((t) => {
      const id = active && activeTask === t.id ? active : t.last_dispatch;
      const w = workerFor(id, terminals);
      return {
        id: t.id, title: t.title ?? "", kind: t.kind ?? "dev", state: t.state ?? "pending",
        attempts: (t.attempts ?? []).length, cycle: t.cycle ?? 0, test: t.test ?? "",
        terminal: w ? { address: w.address, status: statusWord(w.status) } : null,
      };
    }),
    acceptance: (state?.acceptance ?? []).map((a) => ({
      id: a.id, text: a.text ?? "", manual: a.manual === true,
      pass: passById.get(a.id)?.pass ?? null,
      evidence: passById.get(a.id)?.evidence ?? null,
    })),
    reviews: reviews.map((r) => ({ dispatch: r.dispatch, verdict: r.verdict, stale: Boolean(r?.stale), at: r.at })),
  };
}

export function statusLine(state) {
  if (!state) return "No workflow in this worktree · run /herdr-planning";
  const rows = inspectorRows(state);
  if (rows.status === "needs_user") return `Needs user: ${rows.needs_user?.code ?? "unknown"}`;
  if (rows.stage === "ready_for_review") return "Ready for review";
  if (rows.stage === "tuning") return `Tuning · rework ${rows.cycles}`;
  return `Development · ${rows.tasks.filter((t) => t.state === "accepted").length}/${rows.tasks.length} accepted`;
}

export function planningNote(state) {
  const closed = state?.planning?.closed;
  if (!closed || closed === "closed") return null;
  const text = {
    "skipped:disabled": "Planning tab kept: close_planning_tab is off",
    "skipped:in_use": "Planning tab kept: still in use",
    "skipped:other_work": "Planning tab kept: other work in the tab",
    "skipped:last_tab": "Planning tab kept: last tab in the space",
    "skipped:gone": "Planning tab already closed",
    "skipped:identity": "Planning tab kept: identity changed",
    "skipped:moved": "Planning tab kept: moved to another tab",
    "skipped:agent_exited": "Planning tab kept: the agent exited",
    "skipped:app_unavailable": "Planning tab kept: Herdr App unavailable",
    "skipped:close_failed": "Planning tab kept: tab.close failed",
  };
  return text[closed] ?? `Planning tab: ${closed}`;
}
