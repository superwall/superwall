import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as groups } from "@/commands/app-store-connect/store/subscription-groups";
import { ApiError } from "@/core/api/client";
import { answeringRenderer, said } from "../../../helpers/answers";
import type { RendererCall } from "../../../helpers/renderer";
import { ascRoutes, one, page } from "../../../helpers/asc-proxy";
import { runCommand } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

test("in a terminal a destructive operation asks first, and No changes nothing", async () => {
  const { api, writes } = ascRoutes({ "DELETE /v1/subscriptionGroups/201": undefined });
  const calls: RendererCall[] = [];
  await runCommand(groups, { api, words: ["delete", "201"], interactive: true, renderer: answeringRenderer({ select: ["no"] }, calls) });
  assert.deepEqual(said(calls, "error"), ["Cancelled. Nothing was changed."]);
  assert.deepEqual(writes(), []);
  await runCommand(groups, { api, words: ["delete", "201"], interactive: true, renderer: answeringRenderer({ select: ["yes"] }) });
  assert.deepEqual(writes(), [{ method: "DELETE", path: "/v1/subscriptionGroups/201" }]);
});

test("an Apple error with no detail, or a network failure, comes through unchanged", async () => {
  const { api } = ascRoutes({
    "GET /v1/apps/555/subscriptionGroups?limit=200": new ApiError("GET x", 500, "{}"),
    "GET /v1/apps/556/subscriptionGroups?limit=200": new Error("offline"),
  });
  assert.deepEqual((await runCommand(groups, { api, words: ["list", "555"] })).said("error"), ["HTTP 500 — {}\nGET x"]);
  assert.deepEqual((await runCommand(groups, { api, words: ["list", "556"] })).said("error"), ["offline"]);
});

test("an error after a create names what was created even when Apple gives no detail", async () => {
  const { api } = ascRoutes({
    "POST /v1/subscriptionGroups": { data: one("subscriptionGroups", "201") },
    "GET /v1/subscriptionGroups/201/versions": new ApiError("GET x", 503, ""),
  });
  const result = await runCommand(groups, { api, words: ["create"], flags: { ascApp: "555", referenceName: "Pro", displayName: "Pro" } });
  assert.deepEqual(result.said("error"), ["HTTP 503\nAlready created: subscriptionGroups 201."]);
});

test("every page of a list is read", async () => {
  const { api } = ascRoutes({
    "GET /v1/apps/555/subscriptionGroups?limit=200": page([one("subscriptionGroups", "201")], { next: "/v1/apps/555/subscriptionGroups?cursor=B" }),
    "GET /v1/apps/555/subscriptionGroups?cursor=B": page([one("subscriptionGroups", "202")]),
  });
  const result = await runCommand(groups, { api, words: ["list", "555"], json: true });
  assert.deepEqual(result.json, [{ id: "201" }, { id: "202" }]);
});
