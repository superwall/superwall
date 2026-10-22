import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ascRoutes, one, page } from "../../../helpers/asc-proxy";
import { runLine } from "../../../helpers/command";

afterEach(() => {
  process.exitCode = 0;
});

test("asc submit takes repeated ids, through the parser", async () => {
  const { api, writes } = ascRoutes({
    "GET /v1/subscriptions/601/versions": page([one("subscriptionVersions", "V1", { version: 1 })]),
    "GET /v1/subscriptions/602/versions": page([one("subscriptionVersions", "V2", { version: 1 })]),
    "GET /v1/reviewSubmissions?filter[app]=555&filter[state]=READY_FOR_REVIEW&filter[platform]=IOS&limit=1": page([one("reviewSubmissions", "RS0")]),
  });
  const result = await runLine("asc submit --asc-app 555 --subscription 601 --subscription 602 --dry-run --json", { api });
  assert.deepEqual(writes(), []);
  assert.equal((result.json as { requests: unknown[] }).requests.length, 6);
});
