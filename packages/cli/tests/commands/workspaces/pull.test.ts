import assert from "node:assert/strict";
import { test } from "node:test";
import { helpLine, runLine } from "../../helpers/command";
import { scratch } from "../../core/workspaces/fixture";

test("pull has help, and needs a workspace", async () => {
  assert.match(await helpLine("workspaces pull --help"), /workspaces pull/);
  const result = await runLine(`workspaces pull ${scratch()}`, { api: {} });
  assert.ok(result.said("error").length > 0);
  process.exitCode = 0;
});
