import assert from "node:assert/strict";
import { test } from "node:test";
import { helpLine, runLine } from "../../helpers/command";
import { scratch } from "../../core/workspaces/fixture";

test("push has help, and needs a workspace", async () => {
  assert.match(await helpLine("workspaces push --help"), /workspaces push/);
  const result = await runLine(`workspaces push ${scratch()}`, { api: {} });
  assert.ok(result.said("error").length > 0);
  process.exitCode = 0;
});
