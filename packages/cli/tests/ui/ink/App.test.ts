import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React from "react";
import { render } from "ink-testing-library";
import { App } from "@/ui/ink/App";
import { inkRenderer } from "@/ui/ink/runtime";
import { reset } from "@/ui/ink/store";

const columns = process.stdout.columns;

afterEach(() => {
  reset();
  if (columns === undefined) delete (process.stdout as { columns?: number }).columns;
  else process.stdout.columns = columns;
});

const frameOf = async (width: number, options: Array<{ value: string; label: string; hint?: string }>) => {
  process.stdout.columns = width;
  reset();
  void inkRenderer.select({ message: "Which screen?", options });
  const view = render(React.createElement(App));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const frame = view.lastFrame() ?? "";
  view.unmount();
  return frame;
};

test("a hint stays beside its label when the pair fits the terminal", async () => {
  const frame = await frameOf(120, [{ value: "a", label: "App/UpdateRequiredView.swift", hint: "update-required screen" }]);
  assert.match(frame, /● App\/UpdateRequiredView\.swift update-required screen/);
});

test("a hint that would not fit moves under its label instead of wrapping mid-word", async () => {
  const hint = "named like an update-required screen; links to the app store; asks for a store review";
  const frame = await frameOf(60, [
    { value: "a", label: "packages/cli/tests/fixtures/screens/UpdateRequiredView.swift", hint },
    { value: "b", label: "src/RateUs.tsx", hint: "rate-us" },
  ]);
  const lines = frame.split("\n");
  const labelLine = lines.findIndex((line) => line.includes("● packages/cli/tests/fixtures/screens/UpdateRequiredView.swift"));
  assert.notEqual(labelLine, -1, frame);
  assert.match(lines[labelLine + 1] ?? "", /^│\s+named like an update-required screen/);
  assert.match(frame, /○ src\/RateUs\.tsx rate-us/);
});

test("multi-select rows wrap the same way", async () => {
  process.stdout.columns = 50;
  reset();
  void inkRenderer.multiselect({
    message: "Pick",
    options: [{ value: "a", label: "a-very-long-label-for-a-narrow-terminal", hint: "and a hint that cannot share the line" }],
  });
  const view = render(React.createElement(App));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const frame = view.lastFrame() ?? "";
  view.unmount();
  const lines = frame.split("\n");
  const labelLine = lines.findIndex((line) => line.includes("◻ a-very-long-label-for-a-narrow-terminal"));
  assert.notEqual(labelLine, -1, frame);
  assert.match(lines[labelLine + 1] ?? "", /and a hint that cannot share the line/);
});
