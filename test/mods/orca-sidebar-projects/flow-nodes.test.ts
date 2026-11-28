import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { div as kitDiv } from "../../stubs/gpui-kit.js";
import { div } from "../../../src/mods/orca-sidebar-projects/flow-nodes.js";

test("flow nodes are the gpui-kit recorder's div", () => {
  assert.equal(div, kitDiv);
});
