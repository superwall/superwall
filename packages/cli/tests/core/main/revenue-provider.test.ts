import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { command as apps } from "@/commands/main/apps";
import { parseRevenueProvider } from "@/core/main/revenue-provider";
import { answeringRenderer, prompted, said, type Answers } from "../../helpers/answers";
import { runCommand } from "../../helpers/command";
import { clearHomes, useHome } from "../../helpers/home";
import type { RendererCall } from "../../helpers/renderer";
import { routedApi } from "../../helpers/routed-api";

beforeEach(() => {
  const home = useHome();
  fs.writeFileSync(path.join(home, "api-index.json"), JSON.stringify({ version: "test", fetchedAt: Date.now(), operations: [] }));
});

afterEach(() => {
  clearHomes();
  process.exitCode = undefined;
});

const OVERVIEW = "GET /internal/v2/applications/5861/integrations/overview";
const PROVIDER = "PATCH /internal/v2/applications/5861/integrations/revenue-provider";
const PROJECTS = [{ id: "282", name: "test", applications: [{ id: "5861", name: "Demo", platform: "ios" }] }];

const EVENTS = {
  window_days: 30,
  open_revenue: { events: 1, last_received_at: null },
  revenue_cat: { events: 240, last_received_at: null },
};

async function change(
  provider: string,
  overview: object,
  { flags = {}, json = false, answers }: { flags?: Record<string, unknown>; json?: boolean; answers?: Answers } = {},
) {
  const { api, sent } = routedApi({
    "GET /v2/projects": PROJECTS,
    [OVERVIEW]: overview,
    [PROVIDER]: (body) => body as object,
  });
  const calls: RendererCall[] = [];
  const result = await runCommand(apps, {
    words: ["update", "5861"],
    flags: { revenueProvider: provider, ...flags },
    json,
    api,
    interactive: answers !== undefined,
    renderer: answeringRenderer(answers ?? {}, calls),
  });
  return { result, calls, saved: sent.filter((request) => request.method === "PATCH") };
}

test("only open_revenue and revenue_cat are revenue providers", () => {
  assert.equal(parseRevenueProvider("revenue_cat"), "revenue_cat");
  assert.throws(() => parseRevenueProvider("stripe"), /--revenue-provider takes open_revenue or revenue_cat\./);
});

test("in a terminal it says what changes, with the events each source sent, and saves once agreed", async () => {
  const { calls, saved } = await change(
    "open_revenue",
    { revenue_provider: "revenue_cat", revenue_provider_events: EVENTS },
    { answers: { confirm: [true] } },
  );
  assert.deepEqual(said(calls, "warn"), [
    [
      "Every revenue figure in the dashboard for Demo will count only events from open_revenue (the app's store, sent straight to Superwall).",
      "Events from revenue_cat keep arriving and being stored, but stop being counted.",
      "open_revenue sent 1 event in the last 30 days.",
      "revenue_cat sent 240 events in the last 30 days.",
    ].join("\n"),
  ]);
  assert.deepEqual(prompted(calls, "confirm"), ["Count revenue from open_revenue?"]);
  assert.deepEqual(saved, [{ method: "PATCH", path: PROVIDER.slice(6), body: { revenue_provider: "open_revenue" } }]);
  assert.deepEqual(said(calls, "success"), ["`Demo` now counts revenue from open_revenue."]);
});

test("declining in a terminal changes nothing", async () => {
  const { calls, saved } = await change("revenue_cat", { revenue_provider: null }, { answers: { confirm: [false] } });
  assert.match(said(calls, "warn")[0] ?? "", /\(RevenueCat\)\.\nEvents from the other source keep arriving/);
  assert.deepEqual(said(calls, "error"), ["Cancelled. Nothing was changed."]);
  assert.deepEqual(saved, []);
});

test("a dry run says what would change and saves nothing", async () => {
  const { calls, saved } = await change("revenue_cat", { revenue_provider: "open_revenue" }, { flags: { dryRun: true } });
  assert.match(said(calls, "info")[0] ?? "", /^\[dry-run\] would change the revenue provider to revenue_cat\.\nEvery revenue figure/);
  assert.deepEqual(saved, []);

  const plan = await change("revenue_cat", { revenue_provider: "open_revenue" }, { flags: { dryRun: true }, json: true });
  assert.deepEqual(plan.result.json, {
    application_id: "5861",
    revenue_provider: { revenue_provider: "revenue_cat", previous: "open_revenue", changed: false },
  });
});

test("a provider already in place is left as it is, and says so", async () => {
  const { calls, saved } = await change("open_revenue", { revenue_provider: "open_revenue" });
  assert.deepEqual(said(calls, "success"), ["`Demo` already counts revenue from open_revenue."]);
  assert.deepEqual(saved, []);
});
