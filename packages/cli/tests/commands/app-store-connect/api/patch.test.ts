import assert from "node:assert/strict";
import { test } from "node:test";
import { command as patch } from "@/commands/app-store-connect/api/patch";
import { fakeAscApi } from "../../../helpers/asc-proxy";
import { runCommand } from "../../../helpers/command";
import { useAscIndex } from "../../../helpers/asc-spec";

useAscIndex();

process.env.SW_ASC_REFRESH = "1";

test("takes the id of the body from the path", async () => {
  const { api, requests } = fakeAscApi({ "PATCH /v1/subscriptionGroups/G1": { data: { id: "G1" } } });
  await runCommand(patch, {
    api,
    args: { path: "/v1/subscriptionGroups/G1" },
    flags: { d: ["referenceName=Premium"] },
    json: true,
  });
  assert.deepEqual(requests.at(-1)?.body, {
    data: { type: "subscriptionGroups", id: "G1", attributes: { referenceName: "Premium" } },
  });
});
