import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { currentInventory, mergeInventory } from "./rows.js";

for (const mod of ["orca-new-menu", "new-menu"]) {
  test(`${mod} falls back to Herdr after the manager inventory expires`, async () => {
    const known = { key: "codex", installed: false, run: ["codex"] };
    const fresh = { ...known, installed: true, run: ["/custom/codex"] };
    const shared = new Map([["agent-manager.inventory", { at: 1000, agents: [fresh] }]]);
    let now = 2000;
    const scope = {
      View: class {},
      InputState: { new: () => ({ on() {} }) },
      Date: { now: () => now },
      appHome: () => "/test",
      checking: () => true,
      spaces: () => [],
      readTextFile: async () => null,
      knownAgents: async () => [known],
      shared: (key) => shared.get(key),
      setShared: (key, value) => shared.set(key, value),
      currentInventory: (value) => currentInventory(value, now),
      mergeInventory,
    };
    const source = readFileSync(new URL(`../${mod}/main.js`, import.meta.url), "utf8")
      .replace(/^import .*;$/gm, "").replace("export default class NewMenu", "class NewMenu");
    const Menu = vm.runInNewContext(`${source}\nNewMenu`, scope);
    const jobs = [];
    const cx = { focus_handle: () => ({ focus() {} }), notify() {}, spawn(fn) { jobs.push(fn(cx)); } };
    const menu = new Menu();
    menu.init({}, cx);
    await Promise.all(jobs);
    assert.equal(menu.currentState().agents[0].installed, true);
    assert.equal(menu.currentState().agents[0].run[0], "/custom/codex");

    now = 121000;
    assert.equal(menu.currentState().agents[0], known);

    const reopened = new Menu();
    reopened.init({}, cx);
    assert.equal(reopened.currentState().agents[0], known);
    await Promise.all(jobs);
  });
}
