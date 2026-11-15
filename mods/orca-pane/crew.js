// mods/orca-pane/crew.js
// The agents a pane's terminal reports for, from Herdr's one crew relation: a terminal can name
// a parent. Herdr's own agents mod walks the same link with the same live-state filter
// (`herdr-app/defaults/mods/agents/main.js:176`), so a mod does see `parent`.
//
// Status words are Herdr's four (`Model::status`, herdr-app/src/model.rs:528), in display order,
// most attention first. This is not `priority()` order (:92), where `done` outranks `working`.
export const STATUS_ORDER = ["blocked", "working", "done", "idle"];

export function crewOf(all, address) {
  if (!address) return { managing: [], managedBy: null };
  const managing = all.filter((t) => t.parent === address && t.state === "live" && t.status);
  const parentAddr = all.find((t) => t.address === address)?.parent ?? null;
  const managedBy = parentAddr ? anyAgent(all, parentAddr) : null;
  return { managing, managedBy };
}

function anyAgent(all, address) {
  return all.find((t) => t.address === address && t.status) ?? null;
}

export function crewMembers(crew) {
  const seen = new Set();
  const members = [];
  for (const t of [...crew.managing, ...(crew.managedBy ? [crew.managedBy] : [])]) {
    if (seen.has(t.address)) continue;
    seen.add(t.address);
    members.push(t);
  }
  return members;
}

export function crewGroups(crew) {
  const members = crewMembers(crew);
  const byStatus = new Map();
  for (const t of members) {
    const list = byStatus.get(t.status);
    if (list) list.push(t);
    else byStatus.set(t.status, [t]);
  }
  const groups = [];
  for (const status of STATUS_ORDER) {
    const ms = byStatus.get(status);
    if (ms && ms.length) groups.push({ status, members: ms });
  }
  return groups;
}

export function crewSignature(crew) {
  return crewMembers(crew).map((t) => `${t.address}:${t.status}`).join(",");
}
