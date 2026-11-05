import assert from "node:assert/strict";
import { test } from "node:test";
import { helpLine, runLine } from "../../helpers/command";
import { scratch } from "../../core/workspaces/fixture";

test("dev's help lists the context it can fill in", async () => {
  const help = await helpLine("workspaces dev --help");
  for (const flag of ["--port", "--org", "--app", "--campaign", "--audience", "--variant", "--user", "--alias", "--environment", "--context"]) {
    assert.ok(help.includes(flag), flag);
  }
});

test("dev needs a workspace", async () => {
  const result = await runLine(`workspaces dev ${scratch()}`, { api: {} });
  assert.match(result.said("error").join(), /superwall workspaces create/);
  process.exitCode = 0;
});
