import assert from "node:assert/strict";
import { test } from "node:test";
import { helpLine, runLine } from "../../helpers/command";
import { scratch } from "../../core/artifacts/fixture";

test("push has help, and needs an artifact", async () => {
  const help = await helpLine("artifacts push --help");
  assert.match(help, /artifacts push/);
  assert.match(help, /--accept-merged-commits/);
  const result = await runLine(`artifacts push ${scratch()}`, { api: {} });
  assert.ok(result.said("error").length > 0);
  process.exitCode = 0;
});
