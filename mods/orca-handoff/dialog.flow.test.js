import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
const { default: HandoffDialog } = await import("./main.js");

test("fork launches once after Git probes, with the original folder and prompt", async () => {
  for (const [cwd, top, branch, name] of [
    ["/repo", 0, "topic\n", "Fork: topic-fork"], ["/repo", 0, "", "Fork: session-fork"],
    ["/repo", 0, null, "Fork: main-fork"], ["/repo", 1, null, "Session Fork"], ["", 1, null, "Session Fork"],
  ]) {
    const events = [];
    globalThis.__herdrProps = () => ({ overlay: "dialog" });
    globalThis.__herdrExec = (cmd, args, opts) => {
      assert.equal(cmd, "git");
      assert.equal(opts.cwd, cwd);
      events.push(args[0]);
      if (args[0] === "rev-parse") return { code: top, stdout: cwd };
      if (branch === null) throw Error("unavailable");
      return { code: 0, stdout: branch };
    };
    globalThis.__herdrRun = (cmd, args) => events.push([cmd, args]);
    globalThis.__herdrCloseOverlay = id => events.push(id);
    const view = Object.assign(new HandoffDialog(), { cwd, capturedText: "progress", sourceAgent: "codex" });
    const cx = { notify: () => events.push("notify") };
    await view.executeFork(cx);
    await view.executeFork(cx);
    const probes = cwd ? ["rev-parse"] : [];
    if (cwd && top === 0) probes.push("branch");
    assert.deepEqual(events, ["notify", ...probes, ["tab.new", { name, folder: cwd || undefined, task: view.getForkPrompt() }], "dialog"]);
  }
});

test("handoff picker, copy delay and busy fork footer reflect dialog state", async () => {
  const view = Object.assign(new HandoffDialog(), { action: "handoff", cwd: "/repo", capturedText: "progress",
    sourceAgent: "codex", selectedAgentIndex: 1, statusMessage: "ready" });
  const events = [];
  globalThis.__herdrProps = () => ({ overlay: "dialog" });
  globalThis.__herdrCloseOverlay = id => events.push(id);
  const cx = { notify() {}, timer: { after(ms, fn) { events.push(ms); fn(); } } };
  const render = () => JSON.stringify(view.render(cx).__node);
  assert.match(render(), /agent-opt-opencode/);
  assert.match(render(), /Start Session/);
  await view.copyCurrentPrompt(cx);
  assert.deepEqual(events, [600, "dialog"]);
  assert.match(render(), /Copied!/);
  view.action = "fork";
  assert.doesNotMatch(render(), /agent-opt-/);
  assert.match(render(), /Start Fork/);
  view.busy = true;
  assert.match(render(), /Launching…/);
});
