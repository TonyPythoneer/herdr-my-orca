export function sameOperationTarget(expected, current) {
  return Boolean(expected?.root && expected.context && expected.root === current.root &&
    expected.on === current.on && expected.context === current.context && current.activeContext === expected.context);
}
