import assert from "node:assert/strict";
import { test } from "node:test";
import { command as remove } from "@/commands/app-store-connect/api/delete";
import { fakeAscApi } from "../../../helpers/asc-proxy";
import { runCommand } from "../../../helpers/command";

test("sends a DELETE through the signed proxy for the team it's given", async () => {
  const { api, requests } = fakeAscApi({ "DELETE /v1/subscriptionGroups/G1": {} });
  await runCommand(remove, { api, args: { path: "/v1/subscriptionGroups/G1" }, flags: { team: "T9" }, json: true });
  assert.deepEqual(requests.at(-1), {
    method: "DELETE",
    path: "/v2/organizations/7/app-store-connect/proxy/T9/v1/subscriptionGroups/G1",
  });
});
