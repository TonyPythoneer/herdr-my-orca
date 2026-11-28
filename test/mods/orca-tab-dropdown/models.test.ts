import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "vite-plus/test";
import { MODELS } from "../../../src/mods/orca-tab-dropdown/models.js";

type Exec = (command: string, args?: string[]) => Promise<{ code: number; stdout?: string }>;
const globals = globalThis as typeof globalThis & { __herdrExec?: Exec };

const tried: string[] = [];
let answer: (program: string) => string | Error = () => new Error("missing");

beforeEach(() => {
  tried.length = 0;
  answer = () => new Error("missing");
  globals.__herdrExec = async (command, args = []) => {
    tried.push([command, ...args].join(" "));
    const reply = answer(command);
    if (reply instanceof Error) throw reply;
    return { code: 0, stdout: reply };
  };
});

afterEach(() => {
  globals.__herdrExec = undefined;
});

async function probe(key: string): Promise<unknown> {
  const run = MODELS[key].probe;
  assert.ok(run);
  return run();
}

test("the probe tries the bare command, then each install directory in order, and keeps the first that runs", async () => {
  answer = (program) =>
    program === "/home/test/.volta/bin/omp" ? '{"models":[]}' : new Error("missing");
  assert.deepEqual(await probe("omp"), []);
  assert.deepEqual(tried, [
    "omp models --json",
    "/home/test/.bun/bin/omp models --json",
    "/home/test/.local/bin/omp models --json",
    "/home/test/.volta/bin/omp models --json",
  ]);
});

test("when no location runs the agent, the probe rejects with the bare command's error after trying all of them", async () => {
  answer = (program) => new Error(`not found: ${program}`);
  await assert.rejects(probe("omp"), { message: "not found: omp" });
  assert.equal(tried.length, 9);
});

test("omp models are read from the JSON inside its output, with selector, provider/id and name fallbacks", async () => {
  answer = () =>
    'update notice {\n"models":[{"selector":"openai/gpt-5","name":"GPT 5"},{"provider":"anthropic","id":"sonnet","name":""},{"provider":"local","id":"tiny"},{"selector":"sel/only"},{"id":"orphan"},{"selector":"default","name":"Default"},null,{"provider":"x","name":"no id"}]}\ntrailing text';
  assert.deepEqual(await probe("omp"), [
    { id: "openai/gpt-5", label: "GPT 5" },
    { id: "anthropic/sonnet", label: "sonnet" },
    { id: "local/tiny", label: "tiny" },
    { id: "sel/only", label: "sel/only" },
  ]);
});

test("omp output with no JSON object, or without a models array, lists nothing; malformed JSON rejects", async () => {
  answer = () => "no json here";
  assert.deepEqual(await probe("omp"), []);
  answer = () => "}x{";
  assert.deepEqual(await probe("omp"), []);
  answer = () => '{"models":{"id":"x"}}';
  assert.deepEqual(await probe("omp"), []);
  answer = () => "{not json}";
  await assert.rejects(probe("omp"));
});

test("agy models are tab-separated id and label pairs, trimmed, with incomplete lines dropped", async () => {
  answer = () => "gpt-x\tGPT X\nbad-line\nempty-label\t   \n  spaced  \t  Spaced Label  \n";
  assert.deepEqual(await probe("antigravity"), [
    { id: "gpt-x", label: "GPT X" },
    { id: "spaced", label: "Spaced Label" },
  ]);
  assert.deepEqual(tried, ["agy models"]);
});

test("the built-in specs mark the flyout agents, the static model lists and the probed lists", () => {
  assert.equal(MODELS.claude.flyout, true);
  assert.equal(MODELS.gemini.flag, "-m");
  assert.equal(MODELS.gemini.probe, undefined);
  assert.deepEqual(
    MODELS.grok.models?.map((model) => model.id),
    ["grok-4.7", "grok-4.6", "grok-4.5"],
  );
  assert.equal(MODELS.antigravity.flag, "--model");
  assert.equal(typeof MODELS.omp.probe, "function");
});
