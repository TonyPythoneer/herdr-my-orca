import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { settingsPillLeft, settingsReturnPage } from "./agent-settings-route.js";
register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
const { default: Tabs } = await import("./main.js");

test("Back to app stays centered in both layout modes, including asymmetric rails", () => {
  for (const [left,right] of [[280,350],[0,350],[0,0],[280,0],[140,175]]) {
    const x = settingsPillLeft(1440,left,right);
    assert.equal(left + x + 56,720);
  }
  assert.equal(settingsPillLeft(undefined,0,0),null);
  assert.ok(settingsPillLeft(200,120,80) >= 0);
});
test("return target preserves an existing nonterminal page or chooses active terminal/landing", () => {
  const pages = [{id:"main-providers"},{id:"main-tasks"}];
  assert.equal(settingsReturnPage("main-providers",pages,{tabs:[{}]}),"main-providers");
  assert.equal(settingsReturnPage("main-terminals",pages,{tabs:[{}]}),"main-terminals");
  assert.equal(settingsReturnPage("main-landing",pages,{tabs:[]}),"main-landing");
  assert.equal(settingsReturnPage("missing",pages,{tabs:[]}),"main-landing");
});
test("settings route cannot be ejected by syncLanding and renders only its Back control", () => {
  const calls=[];
  globalThis.__herdrRun=(name,args)=>calls.push([name,args]);
  globalThis.__herdrProps=()=>({unified:true});
  globalThis.__herdrLayout=()=>({id:"main",active:"main-agents",children:[]});
  globalThis.__herdrSpaces=()=>[{active:true,tabs:[{id:"one"}]}];
  globalThis.__herdrTheme=()=>new Proxy({}, {get:(_t,k)=>String(k)});
  const view=new Tabs();
  view.syncLanding({});
  assert.deepEqual(calls,[]);
  const result=JSON.stringify(view.render({}).__node);
  assert.ok(result.includes("agent-settings-back"));
  assert.ok(!result.includes('"tab-new"'));
  assert.ok(!result.includes('"tab-track"'));
  delete globalThis.__herdrRun;
  delete globalThis.__herdrProps;
  delete globalThis.__herdrLayout;
  delete globalThis.__herdrSpaces;
  delete globalThis.__herdrTheme;
});
