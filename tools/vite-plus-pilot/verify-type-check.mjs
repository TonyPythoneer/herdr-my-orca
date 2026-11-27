import assert from "node:assert/strict";
import { writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
const file = new URL("./src/__negative_type_probe.ts", import.meta.url);
writeFileSync(file, 'export const typeProbe: number = "not a number";\n', { flag: "wx" });
try {
  const result = spawnSync("npm", ["run", "check"], { encoding: "utf8" });
  assert.ifError(result.error);
  const output = (result.stdout ?? "") + (result.stderr ?? "");
  console.log(output);
  assert.equal(result.signal, null);
  assert.notEqual(result.status, 0, "type check accepted an invalid assignment");
  assert.match(output, /__negative_type_probe\.ts/);
  assert.match(output, /TS2322|not assignable/i);
} finally {
  unlinkSync(file);
}
