import assert from "node:assert/strict";
import { test } from "node:test";
import { helpLine, runLine } from "../../helpers/command";
import { scratch } from "../../core/artifacts/fixture";

test("open has help, and needs an artifact", async () => {
  assert.match(await helpLine("artifacts open --help"), /artifacts open/);
  const result = await runLine(`artifacts open --dir ${scratch()}`, { api: {} });
  assert.ok(result.said("error").length > 0);
  process.exitCode = 0;
});
