export type CloseSide = "left" | "right";

type TabsOwner = { tabs?: readonly { id: string; settled?: boolean }[] };

export function closeSideTabs(
  owner: TabsOwner | null | undefined,
  id: string | undefined,
  side: CloseSide,
): string[] {
  const list = owner?.tabs ?? [];
  const at = list.findIndex((x) => x.id === id);
  if (at < 0) return [];
  const range: [number, number?] = side === "left" ? [0, at] : [at + 1];
  return list
    .slice(...range)
    .filter((x) => !x.settled)
    .map((x) => x.id);
}
