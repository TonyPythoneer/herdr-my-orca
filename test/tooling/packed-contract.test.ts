import { describe, expect, it } from "vite-plus/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compiledSourceBytes,
  packedExpectedBytes,
  stripCodeComments,
} from "../../src/tooling/packed-contract.ts";

describe("packed source byte contract", () => {
  it("removes code comments while preserving line endings and comment markers in literals", () => {
    const source =
      'const text = "/* literal */";\r\nconst pattern = /\\/\\*literal\\*\\//;\n// note\nconst label = `// template`;\n/*block\r\nnext*/\r\n';
    const expected =
      'const text = "/* literal */";\r\nconst pattern = /\\/\\*literal\\*\\//;\n       \nconst label = `// template`;\n       \r\n      \r\n';
    expect(stripCodeComments(source)).toBe(expected);
  });

  it("replaces Unicode comment text with equal UTF-16 width spaces", () => {
    const source = "const label = 1; /* é 🐟 */\n";
    const output = stripCodeComments(source);
    expect(output).toBe("const label = 1;           \n");
    expect(output.length).toBe(source.length);
  });

  it("removes only the leading source banner and adds one final newline", () => {
    const root = mkdtempSync(join(tmpdir(), "packed-contract-bytes-"));
    try {
      mkdirSync(join(root, "typed"));
      writeFileSync(
        join(root, "typed/main.js"),
        '// src/mods/orca-demo/main.ts\nconst value = "π"; // emitted note',
      );
      expect(compiledSourceBytes("src/mods/orca-demo/main.ts", root)).toEqual(
        Buffer.from('const value = "π";                \n'),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps an unrelated first line and an existing final newline", () => {
    const root = mkdtempSync(join(tmpdir(), "packed-contract-banner-"));
    try {
      mkdirSync(join(root, "typed"));
      writeFileSync(join(root, "typed/custom.js"), '"use strict";\nconst value = 1;\n');
      expect(compiledSourceBytes("src/custom.ts", root, "custom")).toEqual(
        Buffer.from('"use strict";\nconst value = 1;\n'),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses packed bytes for TypeScript manifest rows and legacy bytes otherwise", () => {
    const root = mkdtempSync(join(tmpdir(), "packed-contract-manifest-"));
    const previous = process.env.HERDR_PACKED_ARTIFACT_DIR;
    try {
      mkdirSync(join(root, "typed"));
      writeFileSync(
        join(root, "typed/orca-demo.js"),
        "// src/mods/orca-demo/main.ts\nexport const value = 1;",
      );
      process.env.HERDR_PACKED_ARTIFACT_DIR = root;
      const legacy = Buffer.from("legacy");
      const loaded = {
        table: new Map([
          ["mods/orca-demo/main.js", { source: "src/mods/orca-demo/main.ts", packId: "orca-demo" }],
          ["mods/orca-legacy/main.js", { source: "mods/orca-legacy/main.js" }],
        ]),
      };
      expect(packedExpectedBytes("mods/orca-demo/main.js", legacy, loaded)).toEqual(
        Buffer.from("export const value = 1;\n"),
      );
      expect(packedExpectedBytes("mods/orca-legacy/main.js", legacy, loaded)).toBe(legacy);
      expect(packedExpectedBytes("mods/orca-missing/main.js", legacy, loaded)).toBe(legacy);
    } finally {
      if (previous === undefined) delete process.env.HERDR_PACKED_ARTIFACT_DIR;
      else process.env.HERDR_PACKED_ARTIFACT_DIR = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
