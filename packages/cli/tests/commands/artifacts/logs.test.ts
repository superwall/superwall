import assert from "node:assert/strict";
import { test } from "node:test";
import { helpLine, runLine } from "../../helpers/command";
import { scratch } from "../../core/artifacts/fixture";

test("logs has help, and needs an artifact", async () => {
  assert.match(await helpLine("artifacts logs --help"), /artifacts logs/);
  const result = await runLine(`artifacts logs --dir ${scratch()}`, { api: {} });
  assert.ok(result.said("error").length > 0);
  process.exitCode = 0;
});
