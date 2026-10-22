import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as post } from "@/commands/app-store-connect/api/post";
import { fakeAscApi } from "../../../helpers/asc-proxy";
import { runCommand } from "../../../helpers/command";
import { useAscIndex } from "../../../helpers/asc-spec";

useAscIndex();

process.env.SW_ASC_REFRESH = "1";

afterEach(() => {
  process.exitCode = undefined;
});

test("builds the JSON:API body from -d fields and sends it", async () => {
  const { api, requests } = fakeAscApi({ "POST /v1/subscriptionGroups": { data: { id: "G1" } } });
  const result = await runCommand(post, {
    api,
    args: { path: "/v1/subscriptionGroups" },
    flags: { d: ["referenceName=Pro", "app=555"] },
    json: true,
  });
  assert.deepEqual(result.json, { data: { id: "G1" } });
  assert.deepEqual(requests.at(-1)?.body, {
    data: {
      type: "subscriptionGroups",
      attributes: { referenceName: "Pro" },
      relationships: { app: { data: { type: "apps", id: "555" } } },
    },
  });
});

test("a body Apple's schema refuses is stopped, unless --force", async () => {
  const { api, requests } = fakeAscApi();
  const refused = await runCommand(post, { api, args: { path: "/v1/subscriptionGroups" }, flags: { d: ["app=555"] } });
  assert.equal(process.exitCode, 1);
  assert.match(refused.said("error")[0] ?? "", /^Invalid POST \/v1\/subscriptionGroups body:\n {2}• missing required attribute: referenceName/);
  assert.ok(!requests.some((request) => request.method === "POST"));

  process.exitCode = undefined;
  await runCommand(post, { api, args: { path: "/v1/subscriptionGroups" }, flags: { d: ["app=555"], force: true }, json: true });
  assert.equal(process.exitCode, undefined);
  assert.equal(requests.at(-1)?.method, "POST");
});
