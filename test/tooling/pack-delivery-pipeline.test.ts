import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { command, writeAndVerifyDelivery } from "../../src/tooling/pack-delivery.ts";

function tempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `pack-delivery-${label}-`));
}

function compile(source: string): Buffer {
  return Buffer.from(`const source = ${JSON.stringify(source)};\n`);
}

function writeFixture(root: string): void {
  mkdirSync(join(root, "mods/demo"), { recursive: true });
  mkdirSync(join(root, "mods/orca-agent-settings"), { recursive: true });
  writeFileSync(join(root, "settings.json"), "{}");
  writeFileSync(join(root, "mods/demo/main.js"), "const copied = true;\n");
  chmodSync(join(root, "mods/demo/main.js"), 0o755);
  writeFileSync(join(root, "mods/orca-agent-settings/mod.json"), "{}");
}

describe("delivery command runner", () => {
  it("runs in the requested directory and returns stdout", () => {
    const root = tempDir("command");
    try {
      writeFileSync(join(root, "probe.txt"), "from-probe");
      const stdout = command(
        process.execPath,
        ["-e", "process.stdout.write(require('node:fs').readFileSync('probe.txt','utf8'))"],
        root,
      );
      expect(stdout).toBe("from-probe");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws with the command and exit status when a command fails", () => {
    const root = tempDir("failure");
    try {
      expect(() => command(process.execPath, ["-e", "process.exit(3)"], root)).toThrow(/exit/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("delivery writer", () => {
  it("copies byte streams, preserves modes, compiles typed outputs and syntax-checks JavaScript", () => {
    const root = tempDir("write");
    const outputDir = tempDir("write-out");
    try {
      writeFixture(root);
      rmSync(outputDir, { recursive: true, force: true });
      const typed = new Map([
        ["mods/demo/main.js", { source: "src/mods/demo/main.ts", packId: "demo" }],
      ]);
      writeAndVerifyDelivery(
        ["mods/demo/main.js", "mods/orca-agent-settings/mod.json", "settings.json"],
        typed,
        { rootDir: root, outputDir, distDir: join(root, "dist"), compile },
      );
      expect(readFileSync(join(outputDir, "mods/demo/main.js"), "utf8")).toBe(
        'const source = "src/mods/demo/main.ts";\n',
      );
      expect(lstatSync(join(outputDir, "mods/demo/main.js")).mode & 0o777).toBe(0o755);
      expect(readFileSync(join(outputDir, "settings.json"), "utf8")).toBe("{}");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("rejects a symlink instead of delivering its target", () => {
    const root = tempDir("symlink");
    const outputDir = tempDir("symlink-out");
    try {
      writeFixture(root);
      symlinkSync(join(root, "settings.json"), join(root, "mods/demo/link.js"));
      expect(() =>
        writeAndVerifyDelivery(["mods/demo/link.js"], new Map(), {
          rootDir: root,
          outputDir,
          distDir: join(root, "dist"),
          compile,
        }),
      ).toThrow(/not a regular file/);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("rejects compiled output that fails the JavaScript syntax check", () => {
    const root = tempDir("syntax");
    const outputDir = tempDir("syntax-out");
    try {
      writeFixture(root);
      const typed = new Map([
        ["mods/demo/main.js", { source: "src/mods/demo/main.ts", packId: "demo" }],
      ]);
      expect(() =>
        writeAndVerifyDelivery(["mods/demo/main.js", "mods/orca-agent-settings/mod.json"], typed, {
          rootDir: root,
          outputDir,
          distDir: join(root, "dist"),
          compile: () => Buffer.from("const broken = ;\n"),
        }),
      ).toThrow(/--check/);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
