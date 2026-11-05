import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "@/core/api/client";
import { dashboardOrigin, runWorkspaceTry, type TryInput } from "@/core/workspaces/try";
import { DRAFT_MODULE_MAX_BYTES } from "@/core/workspaces/wire";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";
import { fakeWrangler, MANIFEST, workspaceProject, writeVendoredSdk } from "./fixture";

const DRAFT = { id: "a".repeat(64), requested_scopes: ["data:read"], expires_at: "2026-11-06T00:00:00.000Z" };
const SERIES = { points: [{ t: "2026-10-01T00:00:00Z", value: 2.5, breakdown: "A" }, { t: "2026-10-02T00:00:00Z", value: 3 }] };

function context(json = false, mode = "text") {
  const posts: { path: string; body: any }[] = [];
  const calls: RendererCall[] = [];
  const data: unknown[] = [];
  const ctx = {
    ui: recordingRenderer(calls),
    json,
    outputMode: mode,
    output: { data: (value: unknown) => data.push(value) },
    api: {
      host: "https://api.superwall.com",
      post: async (path: string, body: unknown) => {
        posts.push({ path, body });
        return path.endsWith("/drafts") ? DRAFT : { series: SERIES };
      },
    },
  } as never;
  return { ctx, posts, calls, data };
}

const input = (root: string, overrides: Partial<TryInput> = {}): TryInput => ({
  entrypoint: "count",
  dir: root,
  app: "42",
  org: "3",
  days: 30,
  interval: "day",
  filter: [],
  points: false,
  open: true,
  ...overrides,
});

const project = () => {
  const root = workspaceProject();
  writeVendoredSdk(root, "99.0.0");
  return root;
};

test("uploads the bundle and manifest as a draft, then runs the metric on it", async () => {
  const { ctx, posts, calls } = context();
  await runWorkspaceTry(ctx, input(project(), { from: "2026-10-01T00:00:00Z", to: "2026-10-03T00:00:00Z", breakdown: "store", filter: ["store=APP_STORE"], interval: "week" }), { wrangler: fakeWrangler("MODULE") });
  assert.deepEqual(posts[0], {
    path: "/v2/workspaces/drafts",
    body: { organization_id: 3, manifest: MANIFEST, module: "MODULE" },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(posts[1])), {
    path: `/v2/workspaces/drafts/${DRAFT.id}/metric`,
    body: {
      organization_id: 3,
      application_id: 42,
      entrypoint_id: "count",
      from: "2026-10-01T00:00:00Z",
      to: "2026-10-03T00:00:00Z",
      interval: "week",
      breakdown: "store",
      filters: { store: ["APP_STORE"] },
    },
  });
  const success = calls.find((call) => call.method === "success");
  assert.match(String(success?.value), /real runtime, as you/);
  const list = calls.find((call) => call.method === "list")?.value as { items: { label: string; meta: string }[] };
  assert.deepEqual(list.items.map((item) => item.label), ["A", "All"]);
  assert.match(list.items[0]!.meta, /1 points, sum 2\.5/);
});

test("leaves out what wasn't asked for, and defaults to the last --days days", async () => {
  const { ctx, posts } = context();
  const before = Date.now();
  await runWorkspaceTry(ctx, input(project(), { days: 7 }), { wrangler: fakeWrangler() });
  const body = posts[1]!.body;
  assert.equal("breakdown" in body, false);
  assert.equal("filters" in body, false);
  assert.ok(Date.parse(body.to) >= before);
  assert.ok(Math.abs(Date.parse(body.to) - Date.parse(body.from) - 7 * 86_400_000) < 1000);
});

test("--json prints the draft, a summary and the series", async () => {
  const { ctx, data } = context(true);
  await runWorkspaceTry(ctx, input(project()), { wrangler: fakeWrangler() });
  assert.deepEqual(data[0], {
    draft_id: DRAFT.id,
    expires_at: DRAFT.expires_at,
    requested_scopes: DRAFT.requested_scopes,
    entrypoint_id: "count",
    summary: [
      { name: "A", breakdown: "A", points: 1, sum: 2.5, lastAt: "2026-10-01T00:00:00Z", last: 2.5 },
      { name: "All", breakdown: null, points: 1, sum: 3, lastAt: "2026-10-02T00:00:00Z", last: 3 },
    ],
    series: SERIES,
  });
});

test("--points lists every point", async () => {
  const { ctx, calls } = context();
  await runWorkspaceTry(ctx, input(project(), { points: true }), { wrangler: fakeWrangler() });
  const lists = calls.filter((call) => call.method === "list");
  assert.equal(lists.length, 2);
  assert.deepEqual((lists[1]!.value as { items: unknown[] }).items, [
    { label: "2026-10-01T00:00:00Z", meta: "A 2.5" },
    { label: "2026-10-02T00:00:00Z", meta: "3" },
  ]);
});

test("a frame is uploaded and opened in the dashboard, with what it's about in the link", async () => {
  const opened: string[] = [];
  const { ctx, posts, calls } = context(false, "rich");
  await runWorkspaceTry(
    ctx,
    input(project(), { entrypoint: "panel", user: "alice", campaign: "7", environment: "SANDBOX" }),
    { wrangler: fakeWrangler("MODULE"), open: async (url) => (opened.push(url), true) },
  );
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.path, "/v2/workspaces/drafts");
  const url = `https://app.superwall.com/3/workspace-drafts/${DRAFT.id}?entrypoint=panel&app=42&campaign=7&user=alice&environment=SANDBOX`;
  assert.deepEqual(opened, [url]);
  assert.ok(calls.some((call) => call.method === "info" && String(call.value).includes(url)));
});

test("a page needs only its organization, and a link is enough off a terminal or with --no-open", async () => {
  const opened: string[] = [];
  const open = async (url: string) => (opened.push(url), true);
  const first = context();
  await runWorkspaceTry(first.ctx, input(project(), { entrypoint: "home", app: undefined }), { wrangler: fakeWrangler(), open });
  assert.ok(first.calls.some((call) => String(call.value).includes(`/3/workspace-drafts/${DRAFT.id}?entrypoint=home`)));
  const second = context(false, "rich");
  await runWorkspaceTry(second.ctx, input(project(), { entrypoint: "home", open: false }), { wrangler: fakeWrangler(), open });
  assert.deepEqual(opened, []);
});

test("--json prints a frame's link", async () => {
  const { ctx, data } = context(true);
  await runWorkspaceTry(ctx, input(project(), { entrypoint: "home", app: undefined }), { wrangler: fakeWrangler() });
  assert.deepEqual(data[0], {
    draft_id: DRAFT.id,
    expires_at: DRAFT.expires_at,
    requested_scopes: DRAFT.requested_scopes,
    entrypoint_id: "home",
    url: `https://app.superwall.com/3/workspace-drafts/${DRAFT.id}?entrypoint=home`,
  });
});

test("a frame's app has to find an organization", async () => {
  const { ctx } = context();
  (ctx as any).api.list = async () => [{ id: 1, applications: [{ id: 42 }] }];
  await assert.rejects(
    runWorkspaceTry(ctx, input(project(), { entrypoint: "home", org: undefined }), { wrangler: fakeWrangler() }),
    /Couldn't find the organization.*--org/,
  );
});

test("the dashboard follows the API's stage, or an override", () => {
  assert.equal(dashboardOrigin("https://api.superwall.com"), "https://app.superwall.com");
  assert.equal(dashboardOrigin("https://api2.superwall.dev"), "https://app.superwall.dev");
  process.env.SUPERWALL_DASHBOARD_ORIGIN = "http://localhost:3000";
  try {
    assert.equal(dashboardOrigin("http://localhost:4000"), "http://localhost:3000");
  } finally {
    delete process.env.SUPERWALL_DASHBOARD_ORIGIN;
  }
});

test("a readout isn't uploaded, and points at dev", async () => {
  const { ctx, posts } = context();
  await assert.rejects(runWorkspaceTry(ctx, input(project(), { entrypoint: "lift" }), { wrangler: fakeWrangler() }), /readouts can't be tried.*workspaces dev/);
  assert.deepEqual(posts, []);
});

test("code that throws shows its own message, with nothing about the API's reference", async () => {
  const { ctx } = context();
  (ctx as any).api.post = async (path: string) => {
    if (path.endsWith("/drafts")) return DRAFT;
    throw new ApiError(`POST ${path}`, 400, JSON.stringify({ message: "bad sql near SELECT" }));
  };
  await assert.rejects(runWorkspaceTry(ctx, input(project()), { wrangler: fakeWrangler() }), (error: Error) => {
    assert.equal(error.message, "bad sql near SELECT");
    assert.ok(!(error instanceof ApiError));
    return true;
  });
});

test("other API failures stay API failures", async () => {
  const { ctx } = context();
  (ctx as any).api.post = async (path: string) => {
    throw new ApiError(`POST ${path}`, 403, JSON.stringify({ message: "Only members can try a draft." }));
  };
  await assert.rejects(runWorkspaceTry(ctx, input(project()), { wrangler: fakeWrangler() }), ApiError);
});

test("a metric needs an app it can place in an organization", async () => {
  const { ctx } = context();
  await assert.rejects(runWorkspaceTry(ctx, input(project(), { app: undefined }), { wrangler: fakeWrangler() }), /--app <id>/);
  const lookup = context();
  (lookup.ctx as any).api.list = async () => [{ id: 1, applications: [{ id: 42 }] }];
  await assert.rejects(runWorkspaceTry(lookup.ctx, input(project(), { org: undefined }), { wrangler: fakeWrangler() }), /Couldn't find the organization.*--org/);
});

test("a bundle over the draft limit isn't sent", async () => {
  const { ctx, posts } = context();
  await assert.rejects(runWorkspaceTry(ctx, input(project()), { wrangler: fakeWrangler("x".repeat(DRAFT_MODULE_MAX_BYTES + 1)) }), /a draft can be/);
  assert.deepEqual(posts, []);
});

test("--filter is checked before anything is uploaded", async () => {
  const { ctx, posts } = context();
  await assert.rejects(runWorkspaceTry(ctx, input(project(), { filter: ["nope"] }), { wrangler: fakeWrangler() }), /takes key=value/);
  assert.deepEqual(posts, []);
});
