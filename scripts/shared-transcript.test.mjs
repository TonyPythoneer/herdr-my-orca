// Specification of orca-ui/shared/transcript.js, imported from the source (not a mod copy): terminal
// escape stripping, the bounded transcript and the two prompts built from it.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAgentSessionContinuationPrompt, buildAgentSessionForkPrompt, buildBoundedSessionTranscript, cleanAgentSessionForkTranscript,
} from "../orca-ui/shared/transcript.js";

const ESC = "\x1b";
const clean = cleanAgentSessionForkTranscript;

test("clean: non-strings and empty input give an empty string", () => {
  for (const value of [undefined, null, "", 5, {}]) assert.equal(clean(value), "");
});

test("clean: CSI colour and cursor sequences are dropped, with their parameters and intermediates", () => {
  assert.equal(clean(`a${ESC}[31mred${ESC}[0m b`), "ared b");
  assert.equal(clean(`x${ESC}[1;2H${ESC}[?25ly`), "xy");
  assert.equal(clean(`x${ESC}[ q y`), "x y", "an intermediate byte before the final one");
});

test("clean: an unfinished CSI sequence is kept as plain text after the escape is skipped", () => {
  assert.equal(clean(`ab${ESC}[12`), "ab[12");
});

test("clean: OSC sequences end at BEL or at ESC backslash", () => {
  assert.equal(clean(`a${ESC}]0;title\x07b`), "ab");
  assert.equal(clean(`a${ESC}]8;;http://x${ESC}\\b`), "ab");
  assert.equal(clean(`a${ESC}]0;never ends`), "a0;never ends", "an unterminated OSC drops only its two introducer characters");
});

test("clean: single-character escapes and charset selections are dropped", () => {
  for (const letter of ["@", "M", "Z", "\\", "_", "c"]) assert.equal(clean(`a${ESC}${letter}b`), "ab", letter);
  assert.equal(clean(`a${ESC}(Bb`), "ab");
  assert.equal(clean(`a${ESC})0b`), "ab");
  assert.equal(clean(`a${ESC}(`), "a(", "a charset escape with nothing after it is not skipped");
  assert.equal(clean(`a${ESC}~b`), "a~b", "an unknown escape drops only the ESC");
});

test("clean: unsupported control codes are dropped, tabs and form feeds handled as in Orca", () => {
  assert.equal(clean("a\x00\x01\x08b"), "ab");
  assert.equal(clean("a\tb"), "a\tb");
  assert.equal(clean("a\x0bb\x0cc"), "abc");
  assert.equal(clean("a\x0eb\x1fc\x7fd"), "abcd");
  assert.equal(clean("a\x07b"), "ab", "a stray BEL is a control code");
});

test("clean: line endings become \\n and at most three in a row survive; the result is trimmed", () => {
  assert.equal(clean("a\r\nb"), "a\nb");
  assert.equal(clean("a\rb"), "a\nb");
  assert.equal(clean("a\n\n\n\n\nb"), "a\n\n\nb");
  assert.equal(clean("a\r\n\r\n\r\n\r\nb"), "a\n\n\nb");
  assert.equal(clean("  \n a \n  "), "a");
  assert.equal(clean("a\n\nb\n\n\n\nc"), "a\n\nb\n\n\nc");
});

test("bounded transcript: empty means null; long captures keep the tail", () => {
  assert.equal(buildBoundedSessionTranscript(""), null);
  assert.equal(buildBoundedSessionTranscript(undefined), null);
  assert.equal(buildBoundedSessionTranscript(`${ESC}[0m  \n`), null);
  assert.equal(buildBoundedSessionTranscript("hello"), "hello");
  const long = `${"a".repeat(40_000)}END`;
  const bounded = buildBoundedSessionTranscript(long);
  assert.equal(bounded.length, 36_000);
  assert.ok(bounded.endsWith("END"));
  const huge = `${"b".repeat(200_000)}${"c".repeat(10)}`;
  assert.equal(buildBoundedSessionTranscript(huge).length, 36_000);
  assert.ok(buildBoundedSessionTranscript(huge).endsWith("c".repeat(10)));
});

test("fork prompt: header lines, the source and agent labels, and a fence longer than any in the transcript", () => {
  assert.equal(buildAgentSessionForkPrompt({ capturedText: "" }), null);
  const plain = buildAgentSessionForkPrompt({ capturedText: "hi" }).split("\n");
  assert.equal(plain[0], "This is a fork of an existing Orca agent session.");
  assert.ok(!plain.some((line) => line.startsWith("Source:") || line.startsWith("Original agent:")));
  assert.equal(plain.at(-1), "Acknowledge that you have the forked context, then wait for my next instruction.");
  const labelled = buildAgentSessionForkPrompt({ capturedText: "hi", sourceLabel: "tab 1", agentLabel: "Claude" });
  assert.match(labelled, /\nSource: tab 1\nOriginal agent: Claude\n/);
  assert.match(labelled, /\n```text\nhi\n```\n/);
  const fenced = buildAgentSessionForkPrompt({ capturedText: "x ````` y" });
  assert.match(fenced, /\n``````text\nx ````` y\n``````\n/);
});

test("continuation prompt: source lines appear only when given", () => {
  assert.equal(buildAgentSessionContinuationPrompt({ capturedText: " " }), null);
  const bare = buildAgentSessionContinuationPrompt({ capturedText: "hi" });
  assert.equal(bare, [
    "Continue work from the prior Orca session using the context below.",
    "The prior provider session is read-only context; do not resume or modify it.",
    "",
    "Captured transcript:", "```text", "hi", "```", "",
    "Acknowledge that you have the context and tell me what the next step is.",
  ].join("\n"));
  const full = buildAgentSessionContinuationPrompt({ capturedText: "hi", sourceAgent: "Codex", sourceWorkingDirectory: "/w" });
  assert.match(full, /\n\nOriginal agent: Codex\nOriginal working directory: \/w\n\nCaptured transcript:\n/);
  assert.match(buildAgentSessionContinuationPrompt({ capturedText: "hi", sourceWorkingDirectory: "/w" }), /\n\nOriginal working directory: \/w\n\nCaptured/);
});
