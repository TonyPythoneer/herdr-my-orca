import { register } from "node:module";
import { goldenSuite } from "./golden.mjs";

// Same recorder as the other flow tests, with `setShared` routed to the test so a confirmation can be read back.
const loader = new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url).href;
register("data:text/javascript," + encodeURIComponent(`
  import { load as record } from ${JSON.stringify(loader)};
  export { resolve } from ${JSON.stringify(loader)};
  export async function load(url, ctx, next) {
    const result = await record(url, ctx, next);
    if (!url.startsWith("stub:")) return result;
    return { ...result, source: result.source.replace("export const setShared = () => {}", "export const setShared = (...a) => globalThis.__calls.push(['shared', ...a])") };
  }`));
globalThis.__calls = [];
globalThis.__herdrCloseOverlay = (id) => globalThis.__calls.push(["close", id]);
globalThis.__herdrRun = (...a) => globalThis.__calls.push(["run", ...a]);
globalThis.__herdrTheme = () => Object.fromEntries(["input", "raised", "foreground", "solid", "solid_foreground", "popover", "dim", "muted"].map((name, i) => [name, `#${(i + 16).toString(16)}3355`]));
const { default: Confirm } = await import("./main.js");

const dialog = (props) => { globalThis.__herdrProps = () => props; globalThis.__calls = []; return new Confirm(); };
const node = (view) => view.render({}).__node;

goldenSuite("confirm-render", {
  "the dialog renders a given title and detail, or the defaults": async () => ({
    given: node(dialog({ overlay: "o", title: "Delete?", detail: "/a/b", command: { name: "x" } })),
    defaults: node(dialog({ overlay: "o", command: { name: "x" } })),
    noProps: node(dialog(undefined)),
  }),
  "confirming publishes its shared value first, closes the dialog and runs the command with its args": async () => {
    const out = {};
    const yes = (props) => { const v = dialog(props); v.yes(); return globalThis.__calls; };
    out.plain = yes({ overlay: "o", command: { name: "do" } });
    out.args = yes({ overlay: "o", command: { name: "do", args: { a: 1 } } });
    out.shared = yes({ overlay: "o", confirmShared: { key: "k", value: { v: 1 } }, command: { name: "do" } });
    return out;
  },
}, import.meta.url);
