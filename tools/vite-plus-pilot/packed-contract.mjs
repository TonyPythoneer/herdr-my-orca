// During migration only, compare a compiled typed copy to the independently emitted
// Vite+ artifact, never to the legacy JS source bytes. All other files keep their old contract.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function compiledViewportBytes(dist) {
  const content = readFileSync(join(dist, "typed/list-viewport.js"), "utf8");
  return Buffer.from(content + (content.endsWith("\n") ? "" : "\n") +
    "// Generated from tools/vite-plus-pilot/src/list-viewport.ts by vp pack. Candidate only.\n");
}

export function packedExpectedBytes(path, legacy, loaded) {
  const dist = process.env.HERDR_PACKED_ARTIFACT_DIR;
  if (!dist) return legacy;
  const row = loaded.table.get(path);
  return row?.source === "orca-ui/shared/list-viewport.js" ? compiledViewportBytes(dist) : legacy;
}
