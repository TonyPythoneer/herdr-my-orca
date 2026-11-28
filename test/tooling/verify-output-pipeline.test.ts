import { describe, expect, it } from "vite-plus/test";
import {
  buildArtifact,
  verifyBuildEntries,
  verifyManifestOutputs,
} from "../../src/tooling/verify-output.ts";

type Exports = Record<string, unknown>;

function loader(modules: Record<string, Exports>): (url: URL) => Promise<Exports> {
  const suffixes = Object.keys(modules).sort((left, right) => right.length - left.length);
  return async (url: URL) => {
    const suffix = suffixes.find((candidate) => url.pathname.endsWith(candidate));
    if (!suffix) throw new Error(`unexpected artifact ${url.pathname}`);
    return modules[suffix];
  };
}

const viewport = {
  ROW: 30,
  FULL_ROWS: 5,
  VISIBLE_ROWS: 5.5,
  scrolls: (count: number) => (count > 5 ? 1 : 0),
  viewportHeight: (count: number, height: number, gap = 0) => count * (height + gap),
};

const manifestRow = { source: "src/shared/demo.ts", outputs: ["mods/a/demo.js"] };

describe("artifact locations", () => {
  it("points typed builds at typed/<id>.js and delivery builds at delivery/<output>", () => {
    const entry = { id: "demo", source: "src/mods/demo/main.ts", output: "mods/demo/main.js" };
    expect(buildArtifact(entry, false).pathname).toMatch(/\/typed\/demo\.js$/);
    expect(buildArtifact(entry, true).pathname).toMatch(/\/delivery\/mods\/demo\/main\.js$/);
  });
});

describe("manifest output verification", () => {
  it("accepts matching typed, managed-copy and delivery modules", async () => {
    const modules = {
      "typed/demo.js": { value: 1 },
      "mods/a/demo.js": { value: 1 },
      "delivery/mods/a/demo.js": { value: 1 },
    };
    await expect(
      verifyManifestOutputs([manifestRow], false, loader(modules)),
    ).resolves.toBeUndefined();
    await expect(
      verifyManifestOutputs([manifestRow], true, loader(modules)),
    ).resolves.toBeUndefined();
  });

  it("rejects a typed module whose export shape drifted", async () => {
    const modules = {
      "typed/demo.js": { value: 2 },
      "mods/a/demo.js": { value: 1 },
    };
    await expect(verifyManifestOutputs([manifestRow], false, loader(modules))).rejects.toThrow(
      /Vite\+ generated JS/,
    );
  });

  it("rejects a delivery copy that drifted from the source output", async () => {
    const delivery = {
      "typed/demo.js": { value: 1 },
      "mods/a/demo.js": { value: 1 },
      "delivery/mods/a/demo.js": { value: 2 },
    };
    await expect(verifyManifestOutputs([manifestRow], true, loader(delivery))).rejects.toThrow(
      /packed mods\/a\/demo\.js/,
    );
  });

  it("uses viewport geometry probes for the shared list viewport module", async () => {
    const row = { source: "src/shared/list-viewport.ts", outputs: ["mods/a/list-viewport.js"] };
    const modules = {
      "typed/list-viewport.js": viewport,
      "mods/a/list-viewport.js": viewport,
      "delivery/mods/a/list-viewport.js": viewport,
    };
    await expect(verifyManifestOutputs([row], false, loader(modules))).resolves.toBeUndefined();
    await expect(verifyManifestOutputs([row], true, loader(modules))).resolves.toBeUndefined();
  });
});

describe("build entry verification", () => {
  const entry = { id: "demo", source: "src/mods/demo/main.ts", output: "mods/demo/main.js" };

  it("compares typed and delivery artifacts against the managed output", async () => {
    const modules = {
      "typed/demo.js": { run: "same" },
      "mods/demo/main.js": { run: "same" },
      "delivery/mods/demo/main.js": { run: "same" },
    };
    await expect(verifyBuildEntries([entry], false, loader(modules))).resolves.toBeUndefined();
    await expect(verifyBuildEntries([entry], true, loader(modules))).resolves.toBeUndefined();
  });

  it("rejects a built artifact with a different export", async () => {
    const modules = {
      "typed/demo.js": { run: "different" },
      "mods/demo/main.js": { run: "same" },
    };
    await expect(verifyBuildEntries([entry], false, loader(modules))).rejects.toThrow(
      /build entry demo exports/,
    );
  });
});
