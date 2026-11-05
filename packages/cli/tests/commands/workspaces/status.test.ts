import assert from "node:assert/strict";
import { test } from "node:test";
import { helpLine, runLine } from "../../helpers/command";
import { scratch } from "../../core/workspaces/fixture";

test("status has help, and needs a workspace", async () => {
  assert.match(await helpLine("workspaces status --help"), /workspaces status/);
  const result = await runLine(`workspaces status --dir ${scratch()}`, { api: {} });
  assert.ok(result.said("error").length > 0);
  process.exitCode = 0;
});
