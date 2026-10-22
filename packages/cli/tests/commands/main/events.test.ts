import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { helpLine, runLine } from "../../helpers/command";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { fakeResourceApi, op, writeApiIndex, type ApiCall } from "../../helpers/resources";

beforeEach(() => {
  useFetch([]);
  writeApiIndex([
    op("GET", "/v2/projects/{project_id}/events", {
      params: [
        { name: "project_id", in: "path", type: "string", required: true },
        { name: "event_type", in: "query", type: "string", required: false, description: "Only this type" },
      ],
    }),
    op("POST", "/v2/projects/{project_id}/events/{event_id}/retry"),
  ]);
});

afterEach(() => {
  restoreFetch();
  process.exitCode = 0;
});

test("events with no operation lists the app's project's recent events, filtered by a query flag", async () => {
  const calls: ApiCall[] = [];
  const rows = [{ id: "ev_1", event_type: "renewal" }];
  const api = fakeResourceApi(calls, { "GET /v2/projects/282/events?event_type=renewal": { data: rows } });

  const result = await runLine("events --app 5861 --event-type renewal --json", { api });

  assert.deepEqual(calls, [{ method: "GET", path: "/v2/projects/282/events?event_type=renewal" }]);
  assert.deepEqual(result.json, rows);
});

test("an event's delivery attempts render as a list outside --json", async () => {
  const api = fakeResourceApi([], {
    "GET /v2/projects/282/events/ev_1/attempts": { attempts: [{ id: "a1", url: "https://acme.dev/hook" }] },
  });

  const result = await runLine("events attempts ev_1 --app 5861", { api });

  const listed = result.calls.find((call) => call.method === "list")?.value as { items: unknown[] };
  assert.deepEqual(listed.items, [{ label: "https://acme.dev/hook", meta: "a1" }]);
});

test("retrying an event with --dry-run prints the request and sends nothing", async () => {
  const calls: ApiCall[] = [];

  const result = await runLine("events retry ev_1 --app 5861 --dry-run --json", { api: fakeResourceApi(calls) });

  assert.deepEqual(calls, []);
  assert.deepEqual(result.json, { method: "POST", path: "/v2/projects/282/events/ev_1/retry", body: {} });
});

test("an event operation given too many ids names the extra ones", async () => {
  const result = await runLine("events get ev_1 ev_2 --app 5861 --json", { api: fakeResourceApi([]) });

  assert.match((result.json as { error: { message: string } }).error.message, /takes 1 argument; got "ev_2"/);
});

test("events --help lists its operations, and list --help its filters", async () => {
  const help = await helpLine("events --help");
  assert.match(help, /Events sent to your webhooks/);
  assert.match(help, /retry +<event> +Deliver it again/);

  const list = await helpLine("events list --help");
  assert.match(list, /--event-type <string> +Only this type/);
  assert.match(list, /--app <app>/);
  assert.match(list, /--limit <n>/);
});
