import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { helpLine, runLine } from "../../helpers/command";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { fakeResourceApi, op, writeApiIndex, type ApiCall } from "../../helpers/resources";

const STATISTICS = "/v2/projects/282/applications/5861/statistics";

beforeEach(() => {
  useFetch([]);
  writeApiIndex([
    op("GET", "/v2/projects/{id}/applications/{application_id}/statistics"),
    op("GET", "/v2/projects/{id}/applications/{application_id}/recent-transactions"),
    op("PATCH", "/v2/projects/{id}/applications/{application_id}/settings", {
      body: [{ name: "team_id", type: "string | null", required: false, description: "Apple team ID" }],
    }),
  ]);
});

afterEach(() => {
  restoreFetch();
  process.exitCode = 0;
});

test("apps statistics takes the app as its argument and reads it from the app's project", async () => {
  const calls: ApiCall[] = [];
  const api = fakeResourceApi(calls, { [`GET ${STATISTICS}`]: { users: 12, revenue: 99.5 } });

  const result = await runLine("apps statistics 5861 --json", { api });

  assert.deepEqual(calls, [{ method: "GET", path: STATISTICS }]);
  assert.deepEqual(result.json, { users: 12, revenue: 99.5 });
});

test("apps transactions lists rows, narrowed by --search and capped by --limit", async () => {
  const calls: ApiCall[] = [];
  const rows = [
    { id: "t1", identifier: "pro_yearly" },
    { id: "t2", identifier: "pro_monthly" },
    { id: "t3", identifier: "pro_yearly" },
  ];
  const api = fakeResourceApi(calls, { "GET /v2/projects/282/applications/5861/recent-transactions": { data: rows } });

  const result = await runLine("apps transactions --app 5861 --search yearly --limit 1 --json", { api });

  assert.deepEqual(result.json, [{ id: "t1", identifier: "pro_yearly" }]);
  const rich = await runLine("apps transactions --app 5861", { api });
  const listed = rich.calls.find((call) => call.method === "list")?.value as { items: Array<{ label: string; meta?: string }> };
  assert.deepEqual(listed.items, [
    { label: "pro_yearly", meta: "t1" },
    { label: "pro_monthly", meta: "t2" },
    { label: "pro_yearly", meta: "t3" },
  ]);
});

test("apps notices renders the answer as fields outside --json", async () => {
  const api = fakeResourceApi([], {
    "GET /v2/projects/282/applications/5861/overview-notices": { sdk_outdated: true, missing_keys: [] },
  });

  const result = await runLine("apps notices 5861", { api });

  const page = result.said("report").join("\n");
  assert.match(page, /sdk_outdated +yes/);
  assert.match(page, /missing_keys +none/);
});

test("apps update --dry-run shows the settings PATCH without sending it", async () => {
  const calls: ApiCall[] = [];

  const result = await runLine("apps update 5861 --team-id ABC123 --dry-run --json", { api: fakeResourceApi(calls) });

  assert.deepEqual(calls, []);
  assert.deepEqual(result.json, {
    method: "PATCH",
    path: "/v2/projects/282/applications/5861/settings",
    body: { team_id: "ABC123" },
  });
});

test("an operation apps doesn't have is refused with the ones it does", async () => {
  const calls: ApiCall[] = [];

  const result = await runLine("apps rename 5861 --json", { api: fakeResourceApi(calls) });

  assert.match(
    (result.json as { error: { message: string } }).error.message,
    /apps has no "rename"\. It takes: list, get, create, update, use, statistics, transactions, notices\./,
  );
  assert.deepEqual(calls, []);
  assert.equal(process.exitCode, 1);
});

test("apps --help lists its operations and related commands, and an operation's help its flags", async () => {
  const help = await helpLine("apps --help");
  assert.match(help, /apps <operation> <app> \[flags\]/);
  assert.match(help, /transactions +<app> +Its most recent transactions/);
  assert.match(help, /superwall asc keys list --app <app>/);

  const update = await helpLine("apps update --help");
  assert.match(update, /--team-id <string>/);
  assert.match(update, /--revenue-provider <p>/);
  assert.match(update, /Outside a terminal both need --yes/);
});
