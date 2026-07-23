import { test } from "node:test";
import assert from "node:assert/strict";
import { styleMarkdownLine, wrapReportLine } from "@/ui/log";

test("plain markdown links retain both their label and target", () => {
  assert.equal(
    styleMarkdownLine("See [App.swift:12](/tmp/App.swift:12)."),
    "See App.swift:12 (/tmp/App.swift:12).",
  );
});

test("terminal file links use an OSC hyperlink with a file URL and line fragment", () => {
  const rendered = styleMarkdownLine("[App.swift:12](/tmp/App.swift:12)", {
    hyperlinks: true,
  });
  assert.match(rendered, /file:\/\/\/tmp\/App\.swift#L12/);
  assert.doesNotMatch(rendered, /\]\(/);
});

test("report wrapping repeats the bullet's hanging indent", () => {
  const lines = wrapReportLine("  - one two three four five six seven", 20);
  assert.ok(lines.length > 1);
  assert.match(lines[0]!, /^  - /);
  assert.match(lines[1]!, /^    \S/);
});
