import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { helpLine, runLine } from "../../helpers/command";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { fakeResourceApi, op, writeApiIndex, type ApiCall } from "../../helpers/resources";

beforeEach(() => {
  useFetch([]);
  writeApiIndex([
    op("GET", "/v2/campaigns/{id}"),
    op("PUT", "/v2/campaigns/{id}/audiences/{audience_id}/weights", {
      body: [{ name: "weights", type: "object", required: true, description: "Variant id to percentage" }],
    }),
    op("POST", "/v2/campaigns/{id}/archive"),
    op("PATCH", "/v2/campaigns/{id}/placements/{placement_id}", {
      body: [{ name: "event_name", type: "string", required: false, description: "Event name" }],
    }),
  ]);
});

afterEach(() => {
  restoreFetch();
  process.exitCode = 0;
});

test("a bare campaign id is a get of that campaign", async () => {
  const calls: ApiCall[] = [];
  const campaign = { id: 9081, name: "Onboarding", audiences: [] };

  const result = await runLine("campaigns 9081 --json", { api: fakeResourceApi(calls, { "GET /v2/campaigns/9081": campaign }) });

  assert.deepEqual(calls, [{ method: "GET", path: "/v2/campaigns/9081" }]);
  assert.deepEqual(result.json, campaign);
});

test("an audience's readout takes the campaign and the audience as positionals", async () => {
  const calls: ApiCall[] = [];
  const readout = { variants: [{ id: 1, conversion: 0.12 }] };
  const api = fakeResourceApi(calls, { "GET /v2/campaigns/9081/audiences/3/readout": readout });

  const result = await runLine("campaigns audiences readout 9081 3 --json", { api });

  assert.deepEqual(calls, [{ method: "GET", path: "/v2/campaigns/9081/audiences/3/readout" }]);
  assert.deepEqual(result.json, readout);
});

test("variant weights send a typed JSON body, and a placement update a typed field", async () => {
  const calls: ApiCall[] = [];
  const api = fakeResourceApi(calls);

  await runLine('campaigns variants weights 9081 3 --weights {"11":60,"12":40} --json', { api });
  await runLine("campaigns placements update 9081 77 --event-name paywall_open --json", { api });

  assert.deepEqual(calls, [
    { method: "PUT", path: "/v2/campaigns/9081/audiences/3/weights", body: { weights: { 11: 60, 12: 40 } } },
    { method: "PATCH", path: "/v2/campaigns/9081/placements/77", body: { event_name: "paywall_open" } },
  ]);
});

test("archiving a campaign needs --yes outside a terminal, then says it's done", async () => {
  const calls: ApiCall[] = [];
  const api = fakeResourceApi(calls, { "POST /v2/campaigns/9081/archive": { id: 9081, archived: true } });

  const refused = await runLine("campaigns archive 9081 --json", { api });
  assert.match((refused.json as { error: { message: string } }).error.message, /Archive it: POST \/v2\/campaigns\/9081\/archive/);
  assert.deepEqual(calls, []);

  const done = await runLine("campaigns archive 9081 --yes", { api });
  assert.deepEqual(calls, [{ method: "POST", path: "/v2/campaigns/9081/archive", body: {} }]);
  assert.deepEqual(done.said("success"), ["Archive it — done"]);
});

test("too few ids for a nested operation says its usage, and an unknown nested one what it takes", async () => {
  const calls: ApiCall[] = [];
  const api = fakeResourceApi(calls);

  const short = await runLine("campaigns audiences readout 9081 --json", { api });
  assert.match(
    (short.json as { error: { message: string } }).error.message,
    /Usage: superwall campaigns audiences readout <campaign> <audience>/,
  );
  const unknown = await runLine("campaigns variants pause 1 2 --json", { api });
  assert.match(
    (unknown.json as { error: { message: string } }).error.message,
    /campaigns variants has no "pause"\. It takes: create, update, delete, weights\./,
  );
  assert.deepEqual(calls, []);
});

test("campaigns --help lists every nested resource, and a nested resource's help its operations", async () => {
  const help = await helpLine("campaigns --help");
  for (const section of ["campaigns placements", "campaigns audiences", "campaigns variants"]) {
    assert.ok(help.includes(section), section);
  }
  assert.match(help, /campaigns audiences readout <campaign> <audience>/);

  const nested = await helpLine("campaigns audiences --help");
  assert.match(nested, /Who a campaign targets, in order/);
  assert.match(nested, /purchasers +<campaign> <audience> +Users who bought after seeing it/);

  const weights = await helpLine("campaigns variants weights --help");
  assert.match(weights, /--weights <object> +required Variant id to percentage/);
  assert.match(weights, /--dry-run/);
});
