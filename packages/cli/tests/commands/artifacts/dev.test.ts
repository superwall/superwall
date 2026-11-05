import assert from "node:assert/strict";
import { test } from "node:test";
import { helpLine, runLine } from "../../helpers/command";
import { scratch } from "../../core/artifacts/fixture";

test("dev's help lists the context it can fill in", async () => {
  const help = await helpLine("artifacts dev --help");
  for (const flag of ["--port", "--org", "--app", "--campaign", "--audience", "--variant", "--user", "--alias", "--environment", "--context"]) {
    assert.ok(help.includes(flag), flag);
  }
});

test("dev needs an artifact", async () => {
  const result = await runLine(`artifacts dev ${scratch()}`, { api: {} });
  assert.match(result.said("error").join(), /superwall artifacts create/);
  process.exitCode = 0;
});
