import { vi } from "vite-plus/test";
import assert from "node:assert/strict";
import type { Context } from "gpui-kit";
import { goldenSuite } from "../../support/golden.js";

type OverlayProps = {
  overlay?: string;
  title?: string;
  detail?: string;
  command?: { name: string; args?: Record<string, unknown> };
  confirmShared?: { key: string; value: unknown };
};

type State = {
  props: unknown;
  calls: unknown[][];
  theme: Record<string, string>;
};

const state = vi.hoisted((): State => ({
  props: undefined,
  calls: [],
  theme: Object.fromEntries(
    ["input", "raised", "foreground", "solid", "solid_foreground", "popover", "dim", "muted"].map(
      (name, i): [string, string] => [name, `#${(i + 16).toString(16)}3355`],
    ),
  ),
}));

vi.mock("gpui-kit", async () => {
  const { recordedElement } = await import("../../stubs/gpui-recording.js");
  return { View: class {}, div: () => recordedElement("div") };
});

vi.mock("gpui-base", async () => {
  const { recordedElement } = await import("../../stubs/gpui-recording.js");
  return { v_flex: () => recordedElement("v_flex"), h_flex: () => recordedElement("h_flex") };
});

vi.mock("herdr", () => ({
  props: () => state.props,
  theme: () => state.theme,
  setShared: (...args: unknown[]) => {
    state.calls.push(["shared", ...args]);
  },
  closeOverlay: (id?: string) => {
    state.calls.push(["close", id]);
  },
  run: (...args: unknown[]) => {
    state.calls.push(["run", ...args]);
  },
}));

import Confirm from "../../../src/mods/orca-confirm/main";

const dialog = (props: OverlayProps | undefined): Confirm => {
  state.props = props;
  state.calls = [];
  return new Confirm();
};
const node = (view: Confirm): unknown => {
  const element: unknown = view.render({} as Context);
  assert.ok(typeof element === "object" && element !== null);
  return Reflect.get(element, "__node");
};

goldenSuite(
  "confirm-render",
  {
    "the dialog renders a given title and detail, or the defaults": async () => ({
      given: node(
        dialog({ overlay: "o", title: "Delete?", detail: "/a/b", command: { name: "x" } }),
      ),
      defaults: node(dialog({ overlay: "o", command: { name: "x" } })),
      noProps: node(dialog(undefined)),
    }),
    "confirming publishes its shared value first, closes the dialog and runs the command with its args":
      async () => {
        const out: Record<string, unknown[][]> = {};
        const yes = (props: OverlayProps): unknown[][] => {
          const view = dialog(props);
          view.yes();
          return state.calls;
        };
        out.plain = yes({ overlay: "o", command: { name: "do" } });
        out.args = yes({ overlay: "o", command: { name: "do", args: { a: 1 } } });
        out.shared = yes({
          overlay: "o",
          confirmShared: { key: "k", value: { v: 1 } },
          command: { name: "do" },
        });
        return out;
      },
  },
  new URL("../../../mods/orca-confirm/", import.meta.url),
);
