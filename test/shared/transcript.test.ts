import { describe, expect, it } from "vite-plus/test";
import {
  buildAgentSessionContinuationPrompt,
  buildAgentSessionForkPrompt,
  buildBoundedSessionTranscript,
  cleanAgentSessionForkTranscript,
} from "../../src/services/agent-handoff/transcript";

const ESC = "\x1b";

describe("agent session transcripts", () => {
  it("cleans non-string and empty values", () => {
    for (const value of [undefined, null, "", 5, {}]) {
      expect(cleanAgentSessionForkTranscript(value)).toBe("");
    }
  });

  it("removes CSI color and cursor sequences, parameters, and intermediates", () => {
    expect(cleanAgentSessionForkTranscript(`a${ESC}[31mred${ESC}[0m b`)).toBe("ared b");
    expect(cleanAgentSessionForkTranscript(`x${ESC}[1;2H${ESC}[?25ly`)).toBe("xy");
    expect(cleanAgentSessionForkTranscript(`x${ESC}[ q y`)).toBe("x y");
    expect(cleanAgentSessionForkTranscript(`ab${ESC}[12`)).toBe("ab[12");
  });

  it("ends OSC sequences at BEL or ESC backslash and handles truncated sequences", () => {
    expect(cleanAgentSessionForkTranscript(`a${ESC}]0;title\x07b`)).toBe("ab");
    expect(cleanAgentSessionForkTranscript(`a${ESC}]8;;http://x${ESC}\\b`)).toBe("ab");
    expect(cleanAgentSessionForkTranscript(`a${ESC}]0;never ends`)).toBe("a0;never ends");
  });

  it("removes single-character terminal escapes and charset selectors", () => {
    for (const letter of ["@", "M", "Z", "\\", "_", "c"]) {
      expect(cleanAgentSessionForkTranscript(`a${ESC}${letter}b`)).toBe("ab");
    }
    expect(cleanAgentSessionForkTranscript(`a${ESC}(Bb`)).toBe("ab");
    expect(cleanAgentSessionForkTranscript(`a${ESC})0b`)).toBe("ab");
    expect(cleanAgentSessionForkTranscript(`a${ESC}(`)).toBe("a(");
    expect(cleanAgentSessionForkTranscript(`a${ESC}~b`)).toBe("a~b");
  });

  it("drops an escape that ends the capture", () => {
    expect(cleanAgentSessionForkTranscript(`a${ESC}`)).toBe("a");
  });

  it("drops unsupported controls while preserving tabs and normalizing line endings", () => {
    expect(cleanAgentSessionForkTranscript("a\x00\x01\x08b")).toBe("ab");
    expect(cleanAgentSessionForkTranscript("a\tb")).toBe("a\tb");
    expect(cleanAgentSessionForkTranscript("a\x0bb\x0cc")).toBe("abc");
    expect(cleanAgentSessionForkTranscript("a\x0eb\x1fc\x7fd")).toBe("abcd");
    expect(cleanAgentSessionForkTranscript("a\x07b")).toBe("ab");
    expect(cleanAgentSessionForkTranscript("a\r\nb")).toBe("a\nb");
    expect(cleanAgentSessionForkTranscript("a\rb")).toBe("a\nb");
    expect(cleanAgentSessionForkTranscript("a\n\n\n\n\nb")).toBe("a\n\n\nb");
    expect(cleanAgentSessionForkTranscript("a\r\n\r\n\r\n\r\nb")).toBe("a\n\n\nb");
    expect(cleanAgentSessionForkTranscript("  \n a \n  ")).toBe("a");
    expect(cleanAgentSessionForkTranscript("a\n\nb\n\n\n\nc")).toBe("a\n\nb\n\n\nc");
  });

  it("keeps the newest bounded tail after sanitizing captures", () => {
    expect(buildBoundedSessionTranscript("")).toBeNull();
    expect(buildBoundedSessionTranscript(undefined)).toBeNull();
    expect(buildBoundedSessionTranscript(`${ESC}[0m  \n`)).toBeNull();
    expect(buildBoundedSessionTranscript("hello")).toBe("hello");
    const bounded = buildBoundedSessionTranscript(`${"a".repeat(40_000)}END`);
    expect(bounded).toHaveLength(36_000);
    expect(bounded?.endsWith("END")).toBe(true);
    const huge = buildBoundedSessionTranscript(`${"b".repeat(200_000)}${"c".repeat(10)}`);
    expect(huge).toHaveLength(36_000);
    expect(huge?.endsWith("c".repeat(10))).toBe(true);
  });

  it("builds fork prompts with optional labels and a fence longer than transcript fences", () => {
    expect(buildAgentSessionForkPrompt({ capturedText: "" })).toBeNull();
    const plain = buildAgentSessionForkPrompt({ capturedText: "hi" })?.split("\n") ?? [];
    expect(plain[0]).toBe("This is a fork of an existing Orca agent session.");
    expect(
      plain.some((line) => line.startsWith("Source:") || line.startsWith("Original agent:")),
    ).toBe(false);
    expect(plain.at(-1)).toBe(
      "Acknowledge that you have the forked context, then wait for my next instruction.",
    );
    const labelled = buildAgentSessionForkPrompt({
      capturedText: "hi",
      sourceLabel: "tab 1",
      agentLabel: "Claude",
    });
    expect(labelled).toMatch(/\nSource: tab 1\nOriginal agent: Claude\n/);
    expect(labelled).toMatch(/\n```text\nhi\n```\n/);
    expect(buildAgentSessionForkPrompt({ capturedText: "x ````` y" })).toMatch(
      /\n``````text\nx ````` y\n``````\n/,
    );
  });

  it("builds continuation prompts with only the supplied source metadata", () => {
    expect(buildAgentSessionContinuationPrompt({ capturedText: " " })).toBeNull();
    expect(buildAgentSessionContinuationPrompt({ capturedText: "hi" })).toBe(
      [
        "Continue work from the prior Orca session using the context below.",
        "The prior provider session is read-only context; do not resume or modify it.",
        "",
        "Captured transcript:",
        "```text",
        "hi",
        "```",
        "",
        "Acknowledge that you have the context and tell me what the next step is.",
      ].join("\n"),
    );
    expect(
      buildAgentSessionContinuationPrompt({
        capturedText: "hi",
        sourceAgent: "Codex",
        sourceWorkingDirectory: "/w",
      }),
    ).toMatch(
      /\n\nOriginal agent: Codex\nOriginal working directory: \/w\n\nCaptured transcript:\n/,
    );
    expect(
      buildAgentSessionContinuationPrompt({ capturedText: "hi", sourceWorkingDirectory: "/w" }),
    ).toMatch(/\n\nOriginal working directory: \/w\n\nCaptured/);
  });
});
