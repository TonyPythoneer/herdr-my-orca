export type FlowNode = { c?: [string, unknown[]][] };

type Recorded = FlowNode | null | undefined;

const CONTAINERS = ["child", "children", "trigger", "content"];

export function control(node: Recorded, id: string): FlowNode | undefined {
  if (node?.c?.some(([call, args]) => call === "id" && args[0] === id)) return node;
  for (const [call, args] of node?.c ?? []) {
    if (!CONTAINERS.includes(call)) continue;
    for (const child of args.flat()) {
      const found = control(child as Recorded, id);
      if (found) return found;
    }
  }
  return undefined;
}

export function event(node: FlowNode, name: string, button?: string): unknown {
  return node
    .c!.find(([call, args]) => call === name && (!button || args[0] === button))![1]
    .at(-1);
}
