import assert from "node:assert/strict";
import { test } from "node:test";
import { helpLine, runLine } from "../../helpers/command";
import { scratch } from "../../core/artifacts/fixture";

test("update's help says what it does", async () => {
  assert.match(await helpLine("artifacts update --help"), /vendored SDK/);
});

test("update needs an artifact", async () => {
  const result = await runLine(`artifacts update ${scratch()}`);
  assert.match(result.said("error").join(), /superwall artifacts create/);
  process.exitCode = 0;
});
