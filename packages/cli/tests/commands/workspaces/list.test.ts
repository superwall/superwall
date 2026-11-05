import assert from "node:assert/strict";
import { test } from "node:test";
import { helpLine, runLine } from "../../helpers/command";
import { scratch } from "../../core/workspaces/fixture";

test("list has help, and needs a workspace", async () => {
  assert.match(await helpLine("workspaces list --help"), /workspaces list/);
  const result = await runLine(`workspaces list --dir ${scratch()}`, { api: {} });
  assert.ok(result.said("error").length > 0);
  process.exitCode = 0;
});
