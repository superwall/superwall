import assert from "node:assert/strict";
import { test } from "node:test";
import { helpLine, runLine } from "../../helpers/command";
import { scratch } from "../../core/workspaces/fixture";

test("install has help, and needs a workspace", async () => {
  assert.match(await helpLine("workspaces install --help"), /workspaces install/);
  const result = await runLine(`workspaces install --dir ${scratch()}`, { api: {} });
  assert.ok(result.said("error").length > 0);
  process.exitCode = 0;
});
