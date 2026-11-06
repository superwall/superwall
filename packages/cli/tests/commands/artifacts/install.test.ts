import assert from "node:assert/strict";
import { test } from "node:test";
import { helpLine, runLine } from "../../helpers/command";
import { scratch } from "../../core/artifacts/fixture";

test("install has help, and needs an artifact", async () => {
  assert.match(await helpLine("artifacts install --help"), /artifacts install/);
  const result = await runLine(`artifacts install --dir ${scratch()}`, { api: {} });
  assert.ok(result.said("error").length > 0);
  process.exitCode = 0;
});
