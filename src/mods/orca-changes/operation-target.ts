export type OperationTarget = {
  root?: string | null;
  on?: string | null;
  context?: string | null;
  activeContext?: string | null;
};

export function sameOperationTarget(
  expected: OperationTarget | null | undefined,
  current: OperationTarget,
): boolean {
  return Boolean(
    expected?.root &&
    expected.context &&
    expected.root === current.root &&
    expected.on === current.on &&
    expected.context === current.context &&
    current.activeContext === expected.context,
  );
}
