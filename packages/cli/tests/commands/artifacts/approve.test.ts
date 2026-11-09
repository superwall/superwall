import assert from "node:assert/strict";
import { test } from "node:test";
import { helpLine, runLine } from "../../helpers/command";
import { scratch } from "../../core/artifacts/fixture";

test("approve has help, and needs an artifact", async () => {
  assert.match(await helpLine("artifacts approve --help"), /artifacts approve/);
  const result = await runLine(`artifacts approve --dir ${scratch()}`, { api: {} });
  assert.ok(result.said("error").length > 0);
  process.exitCode = 0;
});
