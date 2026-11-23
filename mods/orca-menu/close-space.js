// The Close row of the space card menu and the project group menu.
//
// The host refuses `space.close` without `confirmed: true`
// ("space.close ends its terminals: pass confirmed: true") and asks nothing itself, so a
// row that sent only the id did nothing: a single space could never be closed from these
// menus. The bulk close (`orca-menu.close-group`) already passed `confirmed`, which is why
// a group with two open spaces closed and one with a single space did not.
//
// One id closes that space; several close the whole group in one command, each space with
// `confirmed`. An empty list draws no row. Pure, so `node --test` can check it.
export function closeRows(ids, label = "Close workspace") {
  const list = [...new Set((ids ?? []).filter(Boolean))];
  if (list.length === 0) return [];
  if (list.length === 1) return [[label, "space.close", { id: list[0], confirmed: true }]];
  return [[label, "orca-menu.close-group", { ids: list }]];
}
