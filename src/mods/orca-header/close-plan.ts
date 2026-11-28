export type PlanSpace =
  | { id?: string; folder?: string | null; tabs?: { id: string; settled?: boolean }[] }
  | null
  | undefined;

export type PlanCommand =
  | ["tab.new", { space: string; folder?: string; focus: boolean }]
  | ["tab.close", { id: string }];

export function closePlan(
  spaces: PlanSpace[] | null | undefined,
  tabIds: string[] | null | undefined,
): PlanCommand[] {
  const closing = new Set(tabIds ?? []);
  if (closing.size === 0) return [];
  const fresh: PlanCommand[] = [];
  const seen = new Set<string>();
  for (const space of spaces ?? []) {
    if (!space?.id || seen.has(space.id)) continue;
    const tabs = space.tabs ?? [];
    if (tabs.length === 0 || !tabs.every((t) => closing.has(t.id))) continue;
    seen.add(space.id);
    fresh.push([
      "tab.new",
      { space: space.id, ...(space.folder ? { folder: space.folder } : {}), focus: false },
    ]);
  }
  return [...fresh, ...[...closing].map((id): PlanCommand => ["tab.close", { id }])];
}
