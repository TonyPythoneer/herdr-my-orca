// Rewrite the `tests` arrays of orca-ui/app.mjs `inPlace` from the *.test.* files on disk.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
const root = process.argv[2];
const file = `${root}/orca-ui/app.mjs`;
const { inPlace } = await import(pathToFileURL(file).href + `?t=${Date.now()}`);
const order = ["mod", "area", "description", "layouts", "props", "keys", "opens", "reachedBy", "shared", "tests", "next"];
const out = inPlace.map(e => {
  const tests = readdirSync(`${root}/mods/${e.mod}`, { recursive: true }).filter(f => /\.test\.m?js$/.test(f)).map(f => `mods/${e.mod}/${f}`).sort();
  const next = { ...e, tests: tests.length ? tests : undefined };
  return Object.fromEntries(order.filter(k => next[k] !== undefined).map(k => [k, next[k]]));
});
const text = readFileSync(file, "utf8");
const a = text.indexOf("export const inPlace = [");
const b = text.indexOf("\n];\n", a) + 4;
const body = "export const inPlace = [\n" + out.map(e => "  " + JSON.stringify(e, null, 2).replace(/\n/g, "\n  ")).join(",\n") + "\n];\n";
writeFileSync(file, text.slice(0, a) + body + text.slice(b));
console.log("regenerated", out.length, "entries");
