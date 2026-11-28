export type CloseRow =
  | [label: string, command: "space.close", args: { id: string; confirmed: true }]
  | [label: string, command: "orca-context-menu.close-group", args: { ids: string[] }];

export function closeRows(
  ids: readonly unknown[] | null | undefined,
  label = "Close workspace",
): CloseRow[] {
  const list = [...new Set((ids ?? []).filter((id): id is string => Boolean(id)))];
  if (list.length === 0) return [];
  if (list.length === 1) {
    return [[label, "space.close", { id: list[0], confirmed: true }]];
  }
  return [[label, "orca-context-menu.close-group", { ids: list }]];
}
