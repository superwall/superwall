import assert from "node:assert/strict";
import { test } from "node:test";
import { helpLine, runLine } from "../../helpers/command";
import { workspaceProject, writeVendoredSdk } from "../../core/workspaces/fixture";

test("try's help names the entrypoint and the window", async () => {
  const help = await helpLine("workspaces try --help");
  for (const flag of ["<entrypoint>", "--app", "--days", "--interval", "--breakdown", "--filter", "--points", "--campaign", "--user", "--environment", "--open"]) {
    assert.ok(help.includes(flag), flag);
  }
});

test("try on a readout points at dev", async () => {
  const root = workspaceProject();
  writeVendoredSdk(root, "99.0.0");
  const result = await runLine(`workspaces try lift --dir ${root}`, { api: {} });
  assert.match(result.said("error").join(), /readouts can't be tried/);
  process.exitCode = 0;
});
