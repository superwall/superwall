import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { command as apps } from "@/commands/main/apps";
import { ApiError } from "@/core/api/client";
import { renderApp } from "@/core/main/app-view";
import { runCommand } from "../../helpers/command";
import { routedApi, type Reply } from "../../helpers/routed-api";

afterEach(() => {
  process.exitCode = undefined;
});

test("apps get shows each missing Apple piece with the command that fixes it", () => {
  const text = renderApp({
    app: { id: "5861", name: "Demo", platform: "ios", bundle_id: "com.acme.demo", team_id: "7X2K" },
    project: { id: "282", name: "test" },
    organization: { id: "3642", name: "Acme" },
    integrations: {
      revenue_provider: "open_revenue",
      app_store_connect_configuration: { key_id: "K1", issuer_id: "I", has_private_key: true },
      in_app_purchase_configuration: null,
    },
    server_notifications: {
      url: "https://x",
      status: "already_set",
      message: null,
      retryable: false,
      production: null,
      sandbox: null,
    },
  });
  assert.match(text, /com\.acme\.demo/);
  assert.match(text, /7X2K/);
  assert.match(text, /Acme  ›  test \(282\)/);
  assert.match(text, /✓ K1/);
  assert.match(text, /In-App Purchase key\s+✗ not saved\s+superwall setup apple --app 5861/);
  assert.match(text, /Apple sends to Superwall/);
});

test("apps get shows which reported builds run live and which in test mode, and the URL it couldn't check", () => {
  const text = plain(
    renderApp({
      app: { id: "5861", name: "Demo", platform: "ios", bundle_id: "com.acme.demo", integrated: false },
      project: { id: "282", name: "test" },
      organization: { name: "Acme" },
      integrations: {
        revenue_provider: "open_revenue",
        app_store_connect_configuration: { key_id: "K1", issuer_id: "I", has_private_key: true },
        in_app_purchase_configuration: null,
      },
      notification_url: "https://integrations.example.com/webhook?pk=pk_1",
      sdk: {
        window_days: 30,
        available: true,
        candidates: [
          { bundle_id: "com.acme.demo.widget", production_devices: 3, sandbox_devices: 0, last_seen_at: "2026-10-15T00:00:00Z", top_country: null },
          { bundle_id: "com.acme.beta", production_devices: 1, sandbox_devices: 2, last_seen_at: "2026-10-14T00:00:00Z", top_country: null },
        ],
      },
    }),
  );
  assert.match(text, /com\.acme\.demo\.widget\s+✓ live/);
  assert.match(text, /com\.acme\.beta\s+test mode/);
  assert.match(text, /Notification URL\s+not checked/);
  assert.match(text, /Superwall's URL\s+https:\/\/integrations\.example\.com/);
  assert.doesNotMatch(text, /Integrated/);
});

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");


const keyOf = (key_id: string, has_private_key = true, bundle_id?: string) => ({
  key_id,
  issuer_id: "I",
  has_private_key,
  ...(bundle_id ? { bundle_id } : {}),
});

const notifications = (status: "set" | "not_set" | "conflict" | "skipped", message: string | null = null) => ({
  url: "https://x",
  status,
  message,
  retryable: false,
  production: null,
  sandbox: null,
});

test("apps get names what's off with Apple: a key with no private key, and a notification URL nobody set", () => {
  const text = plain(
    renderApp({
      app: { id: 7, name: "Demo", platform: "ios", bundle_id: "com.acme.demo", apple_search_ads_configured: true },
      project: { id: "282" },
      organization: { id: "3642" },
      integrations: {
        revenue_provider: null,
        app_store_connect_configuration: keyOf("K1", false),
        in_app_purchase_configuration: keyOf("K2", true, "com.acme.demo"),
      },
      server_notifications: notifications("not_set"),
    }),
  );
  assert.match(text, /Organization 3642  ›  Project \(282\)/);
  assert.match(text, /App Store Connect key\s+✗ K1, no private key\s+superwall setup apple --app 7/);
  assert.match(text, /In-App Purchase key\s+✓ K2  com\.acme\.demo/);
  assert.match(text, /Notification URL\s+✗ not set at Apple\s+superwall asc notification-url set --app 7/);
  assert.match(text, /Search Ads\s+✓ connected/);
  assert.match(text, /Provider\s+none chosen: every source is counted/);
});

test("apps get says why Apple could not be asked about the notification URL, or that it needs a key first", () => {
  const skipped = plain(
    renderApp({
      app: { id: 7, platform: "ios" },
      project: { id: "282" },
      organization: {},
      integrations: { revenue_provider: null, app_store_connect_configuration: keyOf("K1"), in_app_purchase_configuration: null },
      server_notifications: notifications("skipped", "Apple is down."),
    }),
  );
  assert.match(skipped, /Notification URL\s+✗ Apple is down\./);
  assert.match(skipped, /^—  iOS · 7/);

  const unknown = plain(renderApp({ app: { id: 7, platform: "ios" }, project: { id: "282" }, organization: {} }));
  assert.match(unknown, /Notification URL\s+✗ unknown until an API key is saved/);
  assert.match(unknown, /Provider\s+unknown/);
  assert.match(unknown, /Search Ads\s+not connected/);
});

test("apps get shows an Android app's package name, its state, revenue counted and support details", () => {
  const text = plain(
    renderApp({
      app: {
        id: 8,
        name: "Droid",
        platform: "android",
        bundle_id: "com.acme.droid",
        globally_disabled: true,
        archived_at: "2026-01-02",
        support_url: "https://acme.com/help",
        support_email: "help@acme.com",
        notification_redirect_url: "https://acme.com/back",
        is_stripe_application: true,
      },
      project: { id: "282", name: "test" },
      organization: { name: "Acme" },
      integrations: {
        revenue_provider: "revenue_cat",
        app_store_connect_configuration: null,
        in_app_purchase_configuration: null,
        revenue_provider_events: {
          window_days: 30,
          open_revenue: { events: 0, last_received_at: null },
          revenue_cat: { events: 12, last_received_at: null },
        },
      },
      sdk: { window_days: 30, available: true, candidates: [] },
    }),
  );
  assert.match(text, /Disabled: the SDK shows no paywalls for this app\./);
  assert.match(text, /Archived 2026-01-02/);
  assert.match(text, /Package name\s+com\.acme\.droid/);
  assert.doesNotMatch(text, /Apple team ID|App Store Connect key/);
  assert.match(text, /SDK, last 30 days\n  Reported\s+nothing: no build has run the SDK/);
  assert.match(text, /Provider\s+revenue_cat  12 events in 30 days  counts revenue_cat, stripe/);
  assert.match(text, /Support URL\s+https:\/\/acme\.com\/help/);
  assert.match(text, /Support email\s+help@acme\.com/);
  assert.match(text, /Redirect URL\s+https:\/\/acme\.com\/back/);
  assert.match(text, /Stripe\s+this is a web checkout app/);
  assert.match(text, /Change it   superwall apps update 8 --help\nRaw data    superwall apps get 8 --json$/);
});

const PROJECTS = [
  { id: "282", name: "test", organization_id: 3642, applications: [{ id: "5861", name: "Demo", platform: "iOS", bundle_id: "com.acme.demo" }] },
];
const OVERVIEW = {
  revenue_provider: "open_revenue",
  app_store_connect_configuration: { key_id: "K1", issuer_id: "I", has_private_key: true },
  in_app_purchase_configuration: null,
};
const APPLE = "/v2/projects/282/applications/5861/integrations/app-store-connect/notification-url";
const VIEW_ROUTES: Record<string, Reply> = {
  "GET /v2/projects": PROJECTS,
  "GET /internal/v2/applications/5861/integrations/overview": OVERVIEW,
  "GET /v2/organizations/3642": { id: 3642, name: "Acme" },
  "GET /internal/v2/applications/5861/bundle-id-suggestions": { window_days: 30, available: true, candidates: [] },
  [`GET ${APPLE}/apple`]: notifications("set"),
  [`GET ${APPLE}`]: { url: "https://integrations.example.com/webhook" },
};

async function appsGet(words: string[], flags: Record<string, unknown>, routes: Record<string, Reply>, json = true) {
  const { api } = routedApi(routes);
  const result = await runCommand(apps, { words, flags, json, api });
  return result;
}

test("apps get --json gathers the app, its project, organization, setup at Apple and what the SDK reported", async () => {
  const result = await appsGet(["get", "5861"], {}, VIEW_ROUTES);
  assert.deepEqual(result.json, {
    app: PROJECTS[0]!.applications[0],
    project: { id: "282", name: "test" },
    organization: { id: "3642", name: "Acme" },
    integrations: OVERVIEW,
    server_notifications: notifications("set"),
    notification_url: "https://integrations.example.com/webhook",
    sdk: { window_days: 30, available: true, candidates: [] },
  });
});

test("apps get leaves out what the API couldn't say instead of failing", async () => {
  const failing = new ApiError("GET /x", 500, "down");
  const result = await appsGet(["get"], { app: "5861" }, {
    ...VIEW_ROUTES,
    "GET /internal/v2/applications/5861/integrations/overview": failing,
    "GET /v2/organizations/3642": failing,
    "GET /internal/v2/applications/5861/bundle-id-suggestions": { window_days: 30, available: false, candidates: [] },
  });
  assert.deepEqual(result.json, {
    app: PROJECTS[0]!.applications[0],
    project: { id: "282", name: "test" },
    organization: { id: "3642" },
  });

  const unchecked = await appsGet(["get", "5861"], {}, {
    ...VIEW_ROUTES,
    [`GET ${APPLE}/apple`]: failing,
    [`GET ${APPLE}`]: failing,
    "GET /v2/organizations/3642": { id: 3642 },
  });
  assert.deepEqual(Object.keys(unchecked.json as object), ["app", "project", "organization", "integrations", "sdk"]);
});

test("apps get with no app named picks the only one, and prints the view outside --json", async () => {
  const result = await appsGet(["get"], {}, VIEW_ROUTES, false);
  assert.match(result.said("report").join("\n"), /^Demo  iOS · 5861\nAcme  ›  test \(282\)/);
});

test("apps get says when the app can't be found or the project has none", async () => {
  const missing = await appsGet(["get", "9999"], {}, { ...VIEW_ROUTES, "GET /v2/paywalls?application_id=9999&limit=1": { data: [] } });
  assert.match((missing.json as { error: { message: string } }).error.message, /^No app 9999 that this account can open/);

  const empty = await appsGet(["get"], {}, { "GET /v2/projects": [{ id: "282", name: "test", applications: [] }] });
  assert.equal((empty.json as { error: { message: string } }).error.message, "test has no apps yet.");
});
