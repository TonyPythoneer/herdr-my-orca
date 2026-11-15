// Turns the three-stage workflow document (`herdr-orca-workflow.md` in the app folder)
// into the cards orca-workflow draws. Pure, so it is tested without Herdr.
export const SAMPLE = {
  schema_version: 1,
  active_stage: "implementation",
  review_return_to_implementation: false,
  stages: [
    { id: "planning", title: "Planning", status: "complete", completed: 5, total: 5, agent_addresses: ["t1"] },
    { id: "implementation", title: "Implementation & Testing", status: "active", completed: 7, total: 12, agent_addresses: ["t2", "t3"] },
    { id: "validation", title: "Validation & Final Tuning", status: "queued", completed: 0, total: 6, agent_addresses: ["t1"] }
  ],
  agent_tasks: { t1: "Planning and final review", t2: "Implement API handlers", t3: "Run integration tests" }
};

export const STATUS_LABEL = { complete: "Complete", active: "In progress", queued: "Queued" };
const SUBTITLE = {
  planning: "Requirements · Design · Acceptance",
  implementation: "Coding · Unit / Integration Tests",
  validation: "Code Review · Acceptance · Tuning"
};

// The file is markdown: the first ```json fence holds the document, else the whole text is JSON.
export function parseDoc(text) {
  const fenced = /```json\s*\n([\s\S]*?)```/.exec(text ?? "");
  return JSON.parse(fenced ? fenced[1] : text);
}

// `agents` is herdr's agents(); a stage address with no running agent is "offline".
export function stageCards(doc, agents = []) {
  const byAddress = new Map(agents.map(a => [a.address, a]));
  return (doc?.stages ?? []).map((s, i) => {
    const total = Math.max(0, Number(s.total) || 0);
    const completed = Math.min(total, Math.max(0, Number(s.completed) || 0));
    return {
      id: s.id,
      number: String(i + 1).padStart(2, "0"),
      title: s.title ?? s.id,
      subtitle: SUBTITLE[s.id] ?? "",
      status: STATUS_LABEL[s.status] ? s.status : "queued",
      completed,
      total,
      fraction: total ? completed / total : 0,
      agents: (s.agent_addresses ?? []).map(address => {
        const a = byAddress.get(address);
        return { address, name: a?.program?.name ?? address, task: doc.agent_tasks?.[address] ?? "", state: a?.status ?? "offline" };
      })
    };
  });
}
