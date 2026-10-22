import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as asaKeys } from "@/commands/apple-search-ads/keys";
import { fakeAsaApi } from "../../helpers/asa";
import { runCommand } from "../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

test("asa keys list reports which apps are connected, as JSON and as rows", async () => {
  const json = await runCommand(asaKeys, { args: { action: "list" }, json: true, api: fakeAsaApi().api });
  assert.deepEqual(json.json, [
    { id: "5", name: "Acme iOS", project: "Acme", organizationId: "org-1", connected: true },
  ]);
  assert.deepEqual(
    json.calls.map((c) => c.method),
    ["start", "stop"],
  );

  const rich = await runCommand(asaKeys, { api: fakeAsaApi().api });
  assert.ok(rich.calls.some((c) => c.method === "step" && String(c.value).includes("1 of 1 iOS app connected")));
  assert.ok(rich.calls.some((c) => c.method === "info" && String(c.value).includes("`Acme iOS`  connected  5")));
});

test("asa keys set explains that credentials live in the dashboard", async () => {
  const out = await runCommand(asaKeys, { args: { action: "set" }, json: true, api: fakeAsaApi().api });
  assert.match((out.json as { error: { message: string } }).error.message, /managed in the dashboard/);
});
