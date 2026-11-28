import { afterEach, test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { SPECS, defaultValues } from "../../../src/shared/agent-flyout.js";
import { flyoutView, input, installHost, resetHost, textOf, type FlyoutKey } from "./host.js";

vi.mock("gpui-kit", async () => {
  const { recordedElement } = await import("../../stubs/gpui-recording.js");
  return {
    View: class {},
    div: () => recordedElement("div"),
    svg: (path: string) => recordedElement("svg", path),
    image: (path: string) => recordedElement("image", path),
  };
});
vi.mock("gpui-base", async (importOriginal) => {
  const actual = await importOriginal<typeof import("gpui-base")>();
  const { recordedElement } = await import("../../stubs/gpui-recording.js");
  return {
    ...actual,
    v_flex: () => recordedElement("v_flex"),
    h_flex: () => recordedElement("h_flex"),
    Scrollbar: { vertical: (...args: unknown[]) => recordedElement("Scrollbar.vertical", ...args) },
    HoverCard: { new: (...args: unknown[]) => recordedElement("HoverCard.new", ...args) },
    Textarea: { new: (...args: unknown[]) => recordedElement("Textarea.new", ...args) },
    Input: { new: (...args: unknown[]) => recordedElement("Input.new", ...args) },
  };
});

const MODELS = [
  {
    id: "m1",
    label: "Model One",
    efforts: ["low", "high"],
    fallbackEffort: "high",
    group: "free",
    free: true,
  },
  { id: "m2", label: "Model Two", efforts: [], fallbackEffort: "high", group: "paid" },
];

type ViewState = Record<string, unknown> & { open?: string | null };

function groupOf(option: unknown): unknown {
  return typeof option === "object" && option !== null && "group" in option
    ? (option.group ?? null)
    : null;
}

function view(key: FlyoutKey, state: ViewState = {}) {
  installHost({ files: new Map(), props: () => ({ key, space: "s1", name: key, argv: [key] }) });
  const spec = SPECS[key];
  const editors = Object.fromEntries(
    Object.entries(spec.options)
      .filter(([, option]) => option.type === "editor")
      .map(([id]) => [
        id,
        { input: input(id === "agents" ? "{}" : "hello"), dirty: false, error: null },
      ]),
  );
  const { open = null, ...rest } = state;
  return flyoutView(key, {
    values: {
      ...defaultValues(spec),
      model: "m1",
      effort: "high",
      codexOff: key === "codex" ? ["apps"] : [],
      advisorModel: "opus",
    },
    editors,
    models: MODELS,
    hidden: new Set(["m2"]),
    showHidden: false,
    error: "",
    providerId: "none",
    providers: { omlx: { name: "oMLX", host: "http://h/v1", models: ["x"], iconPath: "" } },
    open,
    styles: ["default", "Explanatory"],
    naming: false,
    nameError: false,
    styleInput: input(),
    modelGroup: groupOf(spec.options.model),
    groupOpen: false,
    ...rest,
  });
}

const CASES: Record<string, () => ReturnType<typeof view>> = {
  codex: () => view("codex"),
  "codex, provider list open": () => view("codex", { open: "provider" }),
  "codex, model list open": () => view("codex", { open: "model", showHidden: true }),
  claude: () => view("claude"),
  "claude, effort list open": () => view("claude", { open: "effort" }),
  pi: () =>
    view("pi", {
      values: { ...defaultValues(SPECS.pi), model: "m1", effort: "high", off: ["session"] },
    }),
  "pi, thinking list open": () =>
    view("pi", {
      open: "effort",
      values: { ...defaultValues(SPECS.pi), model: "m1", effort: "high" },
    }),
  opencode: () => view("opencode"),
  "opencode, model list open": () => view("opencode", { open: "model" }),
  "opencode, paid model list open": () =>
    view("opencode", { open: "model", modelGroup: "paid", showHidden: true }),
  "opencode, group list open": () => view("opencode", { open: "model", groupOpen: true }),
};

type Json = unknown;

function childOf(call: Json): Json {
  if (!Array.isArray(call) || call[0] !== "child") return null;
  const payload: Json = call[1];
  return Array.isArray(payload) ? payload[0] : undefined;
}

function isBotChild(child: Json): boolean {
  if (typeof child !== "object" || child === null || !("c" in child) || !Array.isArray(child.c))
    return false;
  return child.c.some(
    (method: Json) =>
      Array.isArray(method) &&
      method[0] === "id" &&
      Array.isArray(method[1]) &&
      method[1][0] === "agent-full-settings",
  );
}

function stripRobot(node: Json, found: { count: number; icons: string[] }): void {
  if (Array.isArray(node)) {
    for (let i = node.length - 1; i >= 0; i--) {
      const call: Json = node[i];
      const child = childOf(call);
      if (isBotChild(child)) {
        found.icons.push(textOf(child));
        found.count++;
        node.splice(i, 1);
      } else stripRobot(call, found);
    }
  } else if (typeof node === "object" && node !== null) {
    for (const value of Object.values(node)) stripRobot(value, found);
  }
}

afterEach(() => resetHost());

test("each flyout renders its model controls and settings shortcut", () => {
  for (const [name, make] of Object.entries(CASES)) {
    const recorded: Json = JSON.parse(textOf(make().render()));
    const found = { count: 0, icons: [] as string[] };
    stripRobot(recorded, found);
    assert.equal(found.count, 1, name + " has exactly one robot shortcut");
    assert.ok(found.icons[0]?.includes("mods/orca-assets/bot.svg"), name + " robot icon");
    const text = JSON.stringify(recorded);
    assert.ok(text.includes('"Model"'), name + " renders its model control");
    if (name === "codex, provider list open")
      assert.ok(text.includes("oMLX"), "provider list renders the saved provider");
    if (name === "codex, model list open") {
      assert.ok(
        text.includes("Model One") && text.includes("Model Two"),
        name + " renders model choices",
      );
    }
    if (name === "opencode, model list open") {
      assert.ok(
        text.includes("Model One") && !text.includes("Model Two"),
        "OpenCode's Free filter excludes Paid models",
      );
    }
    if (name === "opencode, paid model list open")
      assert.ok(text.includes("Model Two"), "OpenCode's Paid filter renders paid models");
    if (name === "claude, effort list open" || name === "pi, thinking list open") {
      assert.ok(text.includes("low") && text.includes("high"), name + " renders effort choices");
    }
    if (name === "opencode, group list open")
      assert.ok(text.includes("free") && text.includes("paid"), "OpenCode renders model groups");
  }
});
