import assert from "node:assert/strict";
import { test } from "node:test";
import { helpLine, runLine } from "../../helpers/command";
import { scratch } from "../../core/workspaces/fixture";

test("update's help says what it does", async () => {
  assert.match(await helpLine("workspaces update --help"), /vendored SDK/);
});

test("update needs a workspace", async () => {
  const result = await runLine(`workspaces update ${scratch()}`);
  assert.match(result.said("error").join(), /superwall workspaces create/);
  process.exitCode = 0;
});
