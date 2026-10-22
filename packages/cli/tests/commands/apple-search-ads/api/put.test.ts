import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as asaPut } from "@/commands/apple-search-ads/api/put";
import { fakeAsaApi } from "../../../helpers/asa";
import { helpLine, runCommand, runLine } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

test("asa put refuses a path without a leading slash", async () => {
  const { api } = fakeAsaApi();
  const bad = await runCommand(asaPut, { args: { path: "campaigns" }, json: true, api });
  assert.match((bad.json as { error: { message: string } }).error.message, /must start with/);
});

test("asa put through the parser sends nested -d fields as the body", async () => {
  const { api, requests } = fakeAsaApi(() => ({ data: { id: 9, status: "PAUSED" } }));
  const result = await runLine("asa put /campaigns/9 -d campaign[status]=PAUSED --json", { api });
  assert.deepEqual(requests.at(-1), {
    method: "PUT",
    path: "/v2/organizations/org-1/apple-search-ads/proxy/5/api/v5/campaigns/9",
    body: { campaign: { status: "PAUSED" } },
    headers: undefined,
  });
  assert.deepEqual(result.json, { data: { id: 9, status: "PAUSED" } });
});

test("an asa put Apple answers with nothing prints ok", async () => {
  const { api } = fakeAsaApi(() => undefined);
  const result = await runLine("asa put /campaigns/9 --json", { api });
  assert.deepEqual(result.json, { ok: true });
});

test("asa put --help shows how to pause a campaign", async () => {
  const help = await helpLine("asa put --help");
  assert.match(help, /asa put \/campaigns\/<id> -d campaign\[status\]=PAUSED/);
});
