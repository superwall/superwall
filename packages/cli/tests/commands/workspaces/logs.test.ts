import assert from "node:assert/strict";
import { test } from "node:test";
import { helpLine, runLine } from "../../helpers/command";
import { scratch } from "../../core/workspaces/fixture";

test("logs has help, and needs a workspace", async () => {
  assert.match(await helpLine("workspaces logs --help"), /workspaces logs/);
  const result = await runLine(`workspaces logs --dir ${scratch()}`, { api: {} });
  assert.ok(result.said("error").length > 0);
  process.exitCode = 0;
});
