import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { runRevenueProvider } from "@/commands/platform/revenue-provider";
import { fakeApi, type ApiOptions } from "../../helpers/apple-setup";
import { run } from "../../helpers/command";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";

afterEach(() => {
  process.exitCode = undefined;
});

const EVENTS = {
  window_days: 30,
  open_revenue: { events: 12, last_received_at: "2026-10-01T00:00:00Z" },
  revenue_cat: { events: 340, last_received_at: "2026-10-12T00:00:00Z" },
};

async function provider(
  argv: Record<string, unknown>,
  options: ApiOptions & { interactive?: boolean; confirm?: boolean | null } = {},
) {
  const { api, requests } = fakeApi({
    ...options,
    routes: (method, path, body) =>
      method === "PATCH" && path.endsWith("/integrations/revenue-provider")
        ? { revenue_provider: (body as { revenue_provider: string }).revenue_provider }
        : options.routes?.(method, path, body),
  });
  const calls: RendererCall[] = [];
  const renderer = {
    ...recordingRenderer(calls),
    confirm: async (value: unknown) => (calls.push({ method: "confirm", value }), options.confirm ?? null),
  };
  const result = await run(runRevenueProvider.definition, {
    argv: { project: "5", app: "8", ...argv },
    api,
    interactive: options.interactive ?? false,
    renderer,
  });
  return {
    result,
    said: (method: string) =>
      calls
        .filter((call) => call.method === method)
        .map((call) => String(call.value ?? "").replace(/\u001B\[[0-9;]*m/g, "")),
    writes: () => requests.filter((request) => request.method !== "GET"),
  };
}

test("get reads the provider and what each source sent, and changes nothing", async () => {
  const json = await provider(
    { json: true },
    { saved: { revenue_provider: "revenue_cat", revenue_provider_events: EVENTS } },
  );
  assert.deepEqual(json.result.json, {
    application_id: "8",
    revenue_provider: "revenue_cat",
    events: EVENTS,
  });
  assert.deepEqual(json.writes(), []);

  const human = await provider(
    { action: "get" },
    { saved: { revenue_provider: "revenue_cat", revenue_provider_events: EVENTS } },
  );
  assert.deepEqual(human.said("step"), ["`Acme` counts revenue from revenue_cat (RevenueCat)"]);
  assert.deepEqual(human.said("info"), [
    "open_revenue sent 12 events in the last 30 days",
    "revenue_cat sent 340 events in the last 30 days",
  ]);

  const unset = await provider({ json: true });
  assert.deepEqual(unset.result.json, { application_id: "8", revenue_provider: null, events: null });
  const unsetHuman = await provider({});
  assert.match(unsetHuman.said("step")[0] ?? "", /no revenue provider chosen/);
  assert.deepEqual(unsetHuman.said("info"), []);
});

test("outside a terminal a change is refused without --yes, and says what would change", async () => {
  const run1 = await provider(
    { action: "set", value: "open_revenue" },
    { saved: { revenue_provider: "revenue_cat", revenue_provider_events: EVENTS } },
  );
  assert.equal(process.exitCode, 1);
  assert.deepEqual(run1.writes(), []);
  const message = run1.said("error")[0] ?? "";
  assert.match(message, /will count only events from open_revenue/);
  assert.match(message, /Events from revenue_cat keep arriving and being stored, but stop being counted\./);
  assert.match(message, /revenue_cat sent 340 events in the last 30 days\./);
  assert.match(message, /Nothing was changed\. This is a person's decision.*--yes/);
});

test("--yes changes the provider", async () => {
  const run1 = await provider(
    { action: "set", value: "open_revenue", yes: true, json: true },
    { saved: { revenue_provider: "revenue_cat" } },
  );
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(run1.writes(), [
    {
      method: "PATCH",
      path: "/internal/v2/applications/8/integrations/revenue-provider",
      body: { revenue_provider: "open_revenue" },
    },
  ]);
  assert.deepEqual(run1.result.json, {
    application_id: "8",
    revenue_provider: "open_revenue",
    changed: true,
    previous: "revenue_cat",
  });
  const first = await provider({ action: "set", value: "revenue_cat", yes: true });
  assert.deepEqual(first.said("success"), ["`Acme` now counts revenue from revenue_cat."]);
});

test("in a terminal it asks first, and a refusal changes nothing", async () => {
  const agreed = await provider(
    { action: "set", value: "revenue_cat" },
    { interactive: true, confirm: true },
  );
  assert.match(agreed.said("warn")[0] ?? "", /Events from the other source keep arriving/);
  assert.equal(agreed.writes().length, 1);

  for (const confirm of [false, null]) {
    const declined = await provider(
      { action: "set", value: "revenue_cat" },
      { interactive: true, confirm },
    );
    assert.deepEqual(declined.writes(), []);
    assert.deepEqual(declined.said("warn").at(-1), "Cancelled. Nothing was changed.");
  }
});

test("setting the value it already has does nothing", async () => {
  const json = await provider(
    { action: "set", value: "open_revenue", json: true },
    { saved: { revenue_provider: "open_revenue" } },
  );
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(json.result.json, {
    application_id: "8",
    revenue_provider: "open_revenue",
    changed: false,
  });
  assert.deepEqual(json.writes(), []);
  const human = await provider(
    { action: "set", value: "open_revenue" },
    { saved: { revenue_provider: "open_revenue" } },
  );
  assert.deepEqual(human.said("success"), ["`Acme` already counts revenue from open_revenue."]);
});

test("--dry-run says what would change and exits zero", async () => {
  const json = await provider({ action: "set", value: "revenue_cat", dryRun: true, json: true });
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(json.result.json, {
    dryRun: true,
    application_id: "8",
    from: null,
    to: "revenue_cat",
    events: null,
  });
  const human = await provider({ action: "set", value: "revenue_cat", dryRun: true });
  assert.match(human.said("info").at(-1) ?? "", /^\[dry-run\] would change the revenue provider to revenue_cat\./);
  assert.deepEqual(human.writes(), []);
});

test("bad input names what is accepted", async () => {
  const value = await provider({ action: "set", value: "store" });
  assert.deepEqual(value.said("error"), [
    "Usage: superwall revenue-provider set <open_revenue | revenue_cat> --app <id>",
  ]);
  const action = await provider({ action: "unset" });
  assert.deepEqual(action.said("error"), ['Unknown "revenue-provider unset". Use get | set.']);
  const empty = await provider(
    { app: undefined },
    { projects: [{ id: 5, name: "Main", applications: [] }] },
  );
  assert.deepEqual(empty.said("error"), ["No app found in this project. Pass --app <id>."]);
});
