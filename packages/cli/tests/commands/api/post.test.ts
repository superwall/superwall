import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as post } from "@/commands/api/post";
import { createSuperwallApi } from "@/core/api/client";
import { clearHomes, useHome } from "../../helpers/home";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { runCommand } from "../../helpers/command";

afterEach(() => {
  restoreFetch();
  clearHomes();
  process.exitCode = 0;
});

const api = () =>
  createSuperwallApi({
    authMethod: "api_key",
    apiKey: "sk_live_x",
    host: "https://api.example.com",
    createdAt: new Date().toISOString(),
  });

const spec = {
  info: { version: "2.0.0" },
  paths: {
    "/v2/campaigns/{id}/audiences/{audience_id}/variants": {
      post: { tags: ["Campaigns V2"], summary: "Create Variant", responses: {} },
    },
  },
};

test("a raw request the API rejects carries the reference entry to read", async () => {
  useHome();
  useFetch([
    { match: "/openapi.json", body: spec },
    {
      match: "/v2/campaigns/1/audiences/2/variants",
      status: 400,
      body: { error: { message: 'Expected "treatment" | "holdout"' } },
    },
  ]);
  const result = await runCommand(post, {
    json: true,
    args: { path: "/v2/campaigns/1/audiences/2/variants" },
    flags: { d: ["type=nope"] },
    api: api(),
  });
  const message = (result.json as { error: { message: string } }).error.message;
  assert.match(message, /treatment/);
  assert.match(message, /superwall api docs \/v2\/campaigns\/\{id\}\/audiences\/\{audience_id\}\/variants post/);
});
