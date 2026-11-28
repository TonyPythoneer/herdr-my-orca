export function railRows<T extends { installed: boolean }>(rows: readonly T[]): T[] {
  return [...rows.filter((row) => row.installed), ...rows.filter((row) => !row.installed)];
}
