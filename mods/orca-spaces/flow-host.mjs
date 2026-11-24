// The snapshot recorder normally erases event callbacks. Keep them callable in flow tests
// and supply the host methods for which the shared loader only returns undefined.
import { register, registerHooks } from 'node:module';

register(new URL('../../scripts/gpui-stub-loader.mjs', import.meta.url));
registerHooks({
  load(url, context, next) {
    const result = next(url, context);
    if (!url.startsWith('stub:')) return result;
    const source = result.source.replace('return "fn"', 'return a')
      .replace(/export const (\w+) = \(\) => undefined;/g,
        'export const $1 = (...args) => globalThis.flowHost?.$1?.(...args);');
    return { ...result, source };
  },
});

export function control(node, id) {
  if (node?.c?.some(([call, args]) => call === 'id' && args[0] === id)) return node;
  for (const [call, args] of node?.c ?? []) {
    if (!['child', 'children', 'trigger', 'content'].includes(call)) continue;
    for (const child of args.flat()) {
      const found = control(child, id);
      if (found) return found;
    }
  }
}

export function event(node, name, button) {
  return node.c.find(([call, args]) => call === name && (!button || args[0] === button))[1].at(-1);
}
