import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as asaGet } from "@/commands/apple-search-ads/api/get";
import { fakeAsaApi } from "../../../helpers/asa";
import { helpLine, runCommand, runLine } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

test("asa get passes -d as query params", async () => {
  const { api, requests } = fakeAsaApi();
  await runCommand(asaGet, { args: { path: "/campaigns" }, flags: { d: ["limit=3"] }, json: true, api });
  assert.equal(requests.at(-1)?.path, "/v2/organizations/org-1/apple-search-ads/proxy/5/api/v5/campaigns?limit=3");
});

test("asa get through the parser sends --org-id as Apple's context, and an empty answer prints ok", async () => {
  const { api, requests } = fakeAsaApi(() => undefined);
  const result = await runLine("asa get /me --org-id 42 --json", { api });
  assert.deepEqual(requests.at(-1), {
    method: "GET",
    path: "/v2/organizations/org-1/apple-search-ads/proxy/5/api/v5/me",
    body: undefined,
    headers: { "x-ap-context": "orgId=42" },
  });
  assert.deepEqual(result.json, { ok: true });
});

test("asa get without a path is refused, and its help shows the prefix it adds", async () => {
  const { api, requests } = fakeAsaApi();
  await assert.rejects(runLine("asa get --json", { api }), /Missing <path>/);
  assert.deepEqual(requests, []);
  const help = await helpLine("asa get --help");
  assert.match(help, /the \/api\/v5 prefix is added/);
  assert.match(help, /--org-id <id>/);
});
