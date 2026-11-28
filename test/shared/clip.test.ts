import { it } from "vite-plus/test";
import assert from "node:assert/strict";
import { copyText, reveal } from "../../src/shared/clip";

type ExecCall = { command: string; args: string[] };
type ExecHook = (command: string, args?: string[]) => Promise<{ code: number }>;
type TestHooks = {
  __herdrExec?: ExecHook;
  __clipboard_write_text?: (text: string) => void;
};

function installHooks(hooks: TestHooks): void {
  Object.assign(globalThis, hooks);
}

function removeHooks(...names: Array<keyof TestHooks>): void {
  for (const name of names) Reflect.deleteProperty(globalThis, name);
}

it("copyText sends stringified text to both host clipboard APIs and shell arguments", async () => {
  const calls: ExecCall[] = [];
  const copied: string[] = [];
  const contextCopied: string[] = [];
  installHooks({
    __herdrExec: async (command, args = []) => {
      calls.push({ command, args });
      return { code: 0 };
    },
    __clipboard_write_text: (text) => copied.push(text),
  });

  try {
    copyText(7, { write_to_clipboard: (text) => contextCopied.push(text) });
    assert.deepEqual(copied, ["7"]);
    assert.deepEqual(contextCopied, ["7"]);
    assert.equal(calls[0]?.command, "sh");
    assert.equal(calls[0]?.args.at(-1), "7");

    const hostile = "$(touch /tmp/should-not-run)";
    copyText(hostile);
    assert.equal(calls[1]?.args.at(-1), hostile);
  } finally {
    removeHooks("__herdrExec", "__clipboard_write_text");
  }
});

it("host clipboard hook keeps the host as its receiver and ignores non-function hooks", () => {
  const receivers: unknown[] = [];
  installHooks({
    __clipboard_write_text: function recordReceiver(this: unknown) {
      receivers.push(this);
    },
  });
  try {
    copyText("hook");
    assert.equal(receivers[0], globalThis);
  } finally {
    removeHooks("__clipboard_write_text");
  }
  Object.assign(globalThis, { __clipboard_write_text: 42 });
  try {
    assert.doesNotThrow(() => copyText("ignored"));
  } finally {
    removeHooks("__clipboard_write_text");
  }
});

it("empty clipboard values do nothing and failed clipboard APIs do not block fallback", () => {
  const calls: ExecCall[] = [];
  installHooks({
    __herdrExec: async (command, args = []) => {
      calls.push({ command, args });
      return { code: 0 };
    },
    __clipboard_write_text: () => {
      throw new Error("closed GPUI clipboard");
    },
  });

  try {
    copyText(null, {});
    assert.equal(calls.length, 0);
    copyText("fallback", {
      write_to_clipboard: () => {
        throw new Error("stale window context");
      },
    });
    assert.equal(calls.length, 1);

    removeHooks("__clipboard_write_text");
    copyText("host only", {});
    assert.equal(calls.length, 2);
  } finally {
    removeHooks("__herdrExec", "__clipboard_write_text");
  }
});

it("reveal passes file and directory intent as positional arguments", () => {
  const calls: ExecCall[] = [];
  installHooks({
    __herdrExec: async (command, args = []) => {
      calls.push({ command, args });
      return { code: 0 };
    },
  });

  try {
    reveal("/tmp/file name.txt");
    reveal("/tmp/folder", true);
    assert.deepEqual(
      calls.map(({ command }) => command),
      ["sh", "sh"],
    );
    assert.deepEqual(
      calls.map(({ args }) => args.slice(-2)),
      [
        ["0", "/tmp"],
        ["1", "/tmp/folder"],
      ],
    );
    assert.equal(calls[0]?.args[3], "/tmp/file name.txt");
  } finally {
    removeHooks("__herdrExec");
  }
});

it("clipboard and reveal shell failures remain best effort", async () => {
  installHooks({
    __herdrExec: async () => {
      throw new Error("host command unavailable");
    },
  });
  assert.doesNotThrow(() => copyText("copy"));
  assert.doesNotThrow(() => reveal("/tmp/file"));
  await new Promise((resolve) => setImmediate(resolve));
  removeHooks("__herdrExec");
});
