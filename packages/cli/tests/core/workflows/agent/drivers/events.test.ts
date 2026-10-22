import assert from "node:assert/strict";
import { test } from "node:test";
import { emitAssistantEvents, parseStatus } from "@/core/workflows/agent/drivers/events";
import type { AgentEvent } from "@/core/workflows/agent/drivers/index";

function eventsFor(message: unknown): AgentEvent[] {
  const events: AgentEvent[] = [];
  emitAssistantEvents(message, (event) => events.push(event));
  return events;
}

test("a status is the text after the last [STATUS] marker on its line", () => {
  assert.equal(parseStatus("thinking\n[STATUS]   Installing the SDK  \nmore"), "Installing the SDK");
  assert.equal(parseStatus("no marker here"), undefined);
});

test("assistant text becomes a status when marked, plain text otherwise, and blank text nothing", () => {
  assert.deepEqual(
    eventsFor({
      content: [
        { type: "text", text: "[STATUS] Reading the project" },
        { type: "text", text: "  Found an Xcode project.  " },
        { type: "text", text: "   " },
      ],
    }),
    [
      { type: "status", text: "Reading the project" },
      { type: "text", text: "Found an Xcode project." },
    ],
  );
});

test("tool calls are summarised by the file, command or pattern they touch", () => {
  const command = "x".repeat(80);
  assert.deepEqual(
    eventsFor({
      content: [
        { type: "tool_use", name: "Read", input: { file_path: "/repo/ios/AppDelegate.swift" } },
        { type: "tool_use", name: "Bash", input: { command } },
        { type: "tool_use", name: "Grep", input: { pattern: "Superwall.configure" } },
        { type: "tool_use", name: "WebFetch", input: { url: "https://superwall.com" } },
        { type: "tool_use", name: "TodoWrite", input: null },
      ],
    }),
    [
      { type: "tool", name: "Read", summary: "Read AppDelegate.swift" },
      { type: "tool", name: "Bash", summary: `Bash: ${"x".repeat(60)}` },
      { type: "tool", name: "Grep", summary: "Grep Superwall.configure" },
      { type: "tool", name: "WebFetch", summary: "WebFetch" },
      { type: "tool", name: "TodoWrite", summary: "TodoWrite" },
    ],
  );
});

test("unknown blocks and malformed messages emit nothing", () => {
  assert.deepEqual(
    eventsFor({
      content: [
        null,
        { type: "thinking", thinking: "hmm" },
        { type: "text", text: 42 },
        { type: "tool_use", name: 7 },
      ],
    }),
    [],
  );
  assert.deepEqual(eventsFor(null), []);
  assert.deepEqual(eventsFor("text"), []);
  assert.deepEqual(eventsFor({ role: "assistant" }), []);
  assert.deepEqual(eventsFor({ content: "not blocks" }), []);
});

test("without a listener nothing is parsed", () => {
  assert.doesNotThrow(() => emitAssistantEvents({ content: [{ type: "text", text: "hi" }] }));
});
