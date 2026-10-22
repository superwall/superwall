import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as get } from "@/commands/api/get";
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

const mine = { id: "282", name: "Mine", organization_id: 3642, applications: [] };

test("a raw request that succeeds prints the API's answer, and a server error is left as it is", async () => {
  useHome();
  useFetch([
    { match: "/v2/projects/282", body: mine },
    { match: "/v2/broken", status: 401, body: { error: { message: "Unauthorized" } } },
  ]);
  const ok = await runCommand(get, { json: true, args: { path: "/v2/projects/282" }, api: api() });
  assert.equal((ok.json as { id: string }).id, "282");
  const denied = await runCommand(get, { json: true, args: { path: "/v2/broken" }, api: api() });
  assert.doesNotMatch(JSON.stringify(denied.json), /api docs/);
});

test("a path without a leading slash is refused before any request", async () => {
  useHome();
  const log = useFetch([]);
  const result = await runCommand(get, { json: true, args: { path: "v2/products" }, api: api() });
  assert.match((result.json as { error: { message: string } }).error.message, /Path must start with "\/"/);
  assert.equal(log.length, 0);
});
