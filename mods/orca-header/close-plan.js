// The order a bulk tab close must run in. Herdr turns `tab.close` on a space's only tab into
// `space.close` (and asks "Close space?"), so a space that would lose every tab first gets a
// fresh empty terminal: the space always keeps one tab and the person is never asked to close it.
// Pure — it reads only its arguments — so `node --test` can check it without Herdr.
//
// Returns the commands in order: every `tab.new` first, then every `tab.close`.
export function closePlan(spaces, tabIds) {
  const closing = new Set(tabIds ?? []);
  if (closing.size === 0) return [];

  const fresh = [];
  const seen = new Set();
  for (const space of spaces ?? []) {
    if (!space?.id || seen.has(space.id)) continue;
    const tabs = space.tabs ?? [];
    // A space with a pinned tab (`settled`, never in the list) is not emptied; one that is not
    // touched at all is not emptied either.
    if (tabs.length === 0 || !tabs.every((t) => closing.has(t.id))) continue;
    seen.add(space.id);
    fresh.push(["tab.new", { space: space.id, ...(space.folder ? { folder: space.folder } : {}), focus: false }]);
  }

  return [...fresh, ...[...closing].map((id) => ["tab.close", { id }])];
}
