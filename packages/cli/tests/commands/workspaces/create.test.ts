import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { helpLine, runLine } from "../../helpers/command";
import { scratch } from "../../core/workspaces/fixture";

test("create's help shows the directory and --no-install", async () => {
  const help = await helpLine("workspaces create --help");
  assert.match(help, /workspaces create/);
  assert.match(help, /--install/);
});

test("create refuses a directory with files in it", async () => {
  const target = scratch();
  fs.writeFileSync(path.join(target, "keep"), "x");
  const result = await runLine(`workspaces create ${target}`);
  assert.match(result.said("error").join(), /already has files/);
  process.exitCode = 0;
});
