// Test-only: the stock gpui stub loader, plus a list of every `on_*` handler a render passes in
// (`globalThis.__herdrHandlers`: { key, rec, fn }). The stock stub logs handlers by name only, so a
// test cannot press a click handler that lives inside a view; this lets it. The recorded tree is
// unchanged.
import { load as stockLoad, resolve } from "../../scripts/gpui-stub-loader.mjs";

export { resolve };

const MARKER = "rec.c.push([key, a.map(cleanse)]); return proxy;";
const CAPTURE = `if (key.startsWith("on_")) (globalThis.__herdrHandlers ??= []).push({ key, rec, fn: a.find((x) => typeof x === "function") }); ${MARKER}`;

export async function load(url, context, next) {
  const result = await stockLoad(url, context, next);
  if (!url.startsWith("stub:")) return result;
  const source = String(result.source);
  if (!source.includes(MARKER)) throw new Error("the stub recorder changed; update capture-handlers.loader.mjs");
  // Live sessions and the agent inventory come from the test, like the other stub answers.
  const patched = source
    .replace("export const terminals = () => [];", "export const terminals = () => globalThis.__herdrTerminals?.() ?? [];")
    .replace("export const knownAgents = () => [];", "export const knownAgents = async () => globalThis.__herdrKnownAgents ? globalThis.__herdrKnownAgents() : [];")
    .replace(MARKER, CAPTURE);
  return { ...result, source: patched };
}
