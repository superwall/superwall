import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as get } from "@/commands/app-store-connect/api/get";
import { fakeAscApi } from "../../../helpers/asc-proxy";
import { runCommand } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = undefined;
});

test("sends a GET through the signed proxy for the organization's team", async () => {
  const { api, requests } = fakeAscApi({ "GET /v1/apps": { data: [{ id: "555" }] } });
  const result = await runCommand(get, { api, args: { path: "/v1/apps" }, json: true });
  assert.deepEqual(result.json, { data: [{ id: "555" }] });
  assert.equal(requests.at(-1)?.path, "/v2/organizations/7/app-store-connect/proxy/T1/v1/apps");
});

test("a path must start with a slash", async () => {
  const { api } = fakeAscApi();
  const result = await runCommand(get, { api, args: { path: "v1/apps" } });
  assert.deepEqual(result.said("error"), ['Path must start with "/", e.g. /v1/apps']);
  assert.equal(process.exitCode, 1);
});
