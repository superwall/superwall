import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { helpLine, runLine } from "../../helpers/command";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { fakeResourceApi, op, writeApiIndex, type ApiCall } from "../../helpers/resources";

const ENDPOINTS = "/v2/projects/282/webhook_endpoints";

beforeEach(() => {
  useFetch([]);
  writeApiIndex([
    op("POST", "/v2/projects/{project_id}/webhook_endpoints", {
      body: [
        { name: "url", type: "string", required: true, description: "Where events are sent" },
        { name: "event_types", type: "string[]", required: false },
      ],
    }),
    op("POST", "/v2/projects/{project_id}/webhook_endpoints/{endpoint_id}/rotate_secret"),
    op("DELETE", "/v2/projects/{project_id}/webhook_endpoints/{endpoint_id}"),
  ]);
});

afterEach(() => {
  restoreFetch();
  process.exitCode = 0;
});

test("creating an endpoint fills its project from --app and splits a list field", async () => {
  const calls: ApiCall[] = [];
  const api = fakeResourceApi(calls, { [`POST ${ENDPOINTS}`]: { id: "ep_1", url: "https://acme.dev/hook" } });

  const result = await runLine("webhooks create --app 5861 --url https://acme.dev/hook --event-types renewal,refund --json", {
    api,
  });

  assert.deepEqual(calls, [
    { method: "POST", path: ENDPOINTS, body: { url: "https://acme.dev/hook", event_types: ["renewal", "refund"] } },
  ]);
  assert.deepEqual(result.json, { id: "ep_1", url: "https://acme.dev/hook" });
});

test("rotating a secret is destructive: refused without --yes, sent with it", async () => {
  const calls: ApiCall[] = [];
  const api = fakeResourceApi(calls, { [`POST ${ENDPOINTS}/ep_1/rotate_secret`]: { secret: "whsec_new" } });

  const refused = await runLine("webhooks rotate-secret ep_1 --app 5861 --json", { api });
  assert.match((refused.json as { error: { message: string } }).error.message, /Issue a new signing secret/);
  assert.deepEqual(calls, []);

  const rotated = await runLine("webhooks rotate-secret ep_1 --app 5861 --yes --json", { api });
  assert.deepEqual(calls, [{ method: "POST", path: `${ENDPOINTS}/ep_1/rotate_secret`, body: {} }]);
  assert.deepEqual(rotated.json, { secret: "whsec_new" });
});

test("an endpoint's stats and a deletion's dry run go to that endpoint", async () => {
  const calls: ApiCall[] = [];
  const api = fakeResourceApi(calls, { [`GET ${ENDPOINTS}/ep_1/stats`]: { delivered: 40, failed: 2 } });

  const stats = await runLine("webhooks stats ep_1 --app 5861", { api });
  assert.match(stats.said("report").join(), /delivered +40/);
  const dry = await runLine("webhooks delete ep_1 --app 5861 --dry-run --json", { api });

  assert.deepEqual(dry.json, { method: "DELETE", path: `${ENDPOINTS}/ep_1` });
  assert.deepEqual(calls, [{ method: "GET", path: `${ENDPOINTS}/ep_1/stats` }]);
});

test("a webhook operation that isn't one is refused with the list", async () => {
  const result = await runLine("webhooks ping ep_1 --json", { api: fakeResourceApi([]) });

  assert.match(
    (result.json as { error: { message: string } }).error.message,
    /webhooks has no "ping"\. It takes: list, get, create, update, delete, rotate-secret, attempts, stats\./,
  );
});

test("webhooks --help lists its operations, and create --help its body", async () => {
  const help = await helpLine("webhooks --help");
  assert.match(help, /rotate-secret +<endpoint> +Issue a new signing secret/);

  const create = await helpLine("webhooks create --help");
  assert.match(create, /--url <string> +required Where events are sent/);
  assert.match(create, /--event-types <string\[\]>/);
  assert.match(create, /--app <app>/);
});
