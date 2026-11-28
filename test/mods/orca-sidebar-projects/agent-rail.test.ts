import { it } from "vite-plus/test";
import assert from "node:assert/strict";
import * as SidebarUI from "../../../src/config/ui-settings/agent-settings/sidebar.js";
import {
  railGeometry,
  railViewport,
  railRows,
  railControl,
  type RailRow,
} from "../../../src/mods/orca-sidebar-projects/agent-rail.js";

it("global and every agent indicator are centered on the rounded-square avatar", () => {
  for (const offset of [0, 60, 120, 330, -180]) {
    for (const [selected, hovered] of [
      [true, false],
      [false, true],
      [true, true],
      [false, false],
    ]) {
      const g = railGeometry(selected, hovered);
      assert.equal(
        offset + g.avatarTop + SidebarUI.AVATAR__SIZE_PX / 2,
        offset + g.indicatorTop + g.indicatorHeight / 2,
      );
      assert.equal(g.indicatorLeft, 0);
      assert.equal(g.avatarLeft + SidebarUI.AVATAR__SIZE_PX / 2, SidebarUI.SIDEBAR__WIDTH_PX / 2);
    }
  }
  assert.equal(railGeometry().indicatorHeight, SidebarUI.SELECTION_INDICATOR__IDLE_HEIGHT_PX);
  assert.equal(railGeometry(true).indicatorTop, 10);
  assert.equal(SidebarUI.AVATAR__RADIUS_PX, 13);
  assert.equal(SidebarUI.GROUP__LEFT_OFFSET_PX + SidebarUI.GROUP__WIDTH_PX / 2, SidebarUI.SIDEBAR__WIDTH_PX / 2);
});

it("each group caps independently at five and a half rows", () => {
  for (const count of [0, 1, 5, 6, 22])
    assert.deepEqual(railViewport(count), {
      height: count <= 5 ? count * 60 : 330,
      scroll: count > 5,
    });
});

it("installed first, stable when toggling, no switch for missing CLI", () => {
  const rows: RailRow[] = [
    { key: "a", installed: false },
    { key: "b", installed: true, enabled: false },
    { key: "c", installed: true, enabled: true },
  ];
  assert.deepEqual(
    railRows(rows).map((r) => r.key),
    ["b", "c", "a"],
  );
  rows[1].enabled = true;
  assert.deepEqual(
    railRows(rows).map((r) => r.key),
    ["b", "c", "a"],
  );
  assert.deepEqual(railControl(rows[0]), { kind: "install" });
  assert.deepEqual(railControl(rows[1]), { kind: "switch", checked: true });
  rows[1].enabled = false;
  assert.deepEqual(railControl(rows[1]), { kind: "switch", checked: false });
});

it("agent availability switch uses its visible track dimensions", () => {
  assert.equal(SidebarUI.ENABLE_SWITCH__WIDTH_PX, 27);
  assert.equal(SidebarUI.ENABLE_SWITCH__HEIGHT_PX, 17);
  assert.equal(Object.hasOwn(SidebarUI, "hitWidth"), false);
  assert.equal(Object.hasOwn(SidebarUI, "hitHeight"), false);
});
