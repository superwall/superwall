import assert from "node:assert/strict";
import { test } from "node:test";
import { blocks, createCommandOutput, formatJson, writeJson } from "@/output";
import { recordingRenderer } from "./helpers/renderer";

test("JSON formatting is centralized at two spaces with a trailing newline", () => {
  let stdout = "";
  writeJson(
    {
      write: (value) => {
        stdout += String(value);
        return true;
      },
    },
    { rows: [{ ok: true }] },
  );

  assert.equal(stdout, '{\n  "rows": [\n    {\n      "ok": true\n    }\n  ]\n}\n');
  assert.equal(formatJson({ ok: true }), '{\n  "ok": true\n}');
});

test("JSON mode writes data without rendering UI blocks", () => {
  let stdout = "";
  const calls: Array<{ method: string }> = [];
  const output = createCommandOutput("json", recordingRenderer(calls), {
    stdout: {
      write: (value) => {
        stdout += String(value);
        return true;
      },
    },
  });

  output.render(blocks.intro("hidden"), blocks.nextSteps(["hidden"]));
  output.data({ ok: true });

  assert.equal(stdout, '{\n  "ok": true\n}\n');
  assert.deepEqual(calls, []);
});

test("output blocks compose reusable rich UI components", () => {
  const calls: Array<{ method: string; value?: unknown }> = [];
  const output = createCommandOutput("rich", recordingRenderer(calls));

  output.render(
    blocks.intro("Title"),
    blocks.list({ items: [{ label: "one" }] }),
    blocks.nextSteps(["Ship", "Verify"]),
  );

  assert.deepEqual(
    calls.map((call) => call.method),
    ["intro", "list", "note"],
  );
  assert.deepEqual(calls[2]?.value, {
    value: "1. Ship\n2. Verify",
    title: "Next steps",
  });
});
