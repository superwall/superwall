import assert from "node:assert/strict";
import { test } from "node:test";
import { helpLine, runLine } from "../../helpers/command";
import { scratch } from "../../core/workspaces/fixture";

test("share has help, and needs a workspace", async () => {
  assert.match(await helpLine("workspaces share --help"), /workspaces share/);
  const result = await runLine(`workspaces share --dir ${scratch()}`, { api: {} });
  assert.ok(result.said("error").length > 0);
  process.exitCode = 0;
});
