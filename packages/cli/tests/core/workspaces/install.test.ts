import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { runWorkspaceInstall, runWorkspaceList, runWorkspaceOpen, type InstallInput } from "@/core/workspaces/install";
import { fakeContext } from "./fake-api";
import { scratch } from "./fixture";

const workspace = { id: 42, organization_id: 7, slug: "churn", name: "Churn", state: "active", active_version_id: 1 };
const row = { entrypoint_id: "panel", slot: "user.panel@1", application_id: 9, enabled: true, position: 0 };

function setup(options: Parameters<typeof fakeContext>[1] & { versions?: unknown[]; projects?: unknown[] } = {}) {
  const sent: { method: string; path: string; body?: unknown }[] = [];
  const api = {
    host: "https://api.superwall.com",
    list: async () => options.projects ?? [],
    get: async (route: string) => {
      if (route.endsWith("/installations")) return { data: [row, { ...row, application_id: null, enabled: false }] };
      if (route.startsWith("/v2/workspaces?")) return { data: [workspace] };
      if (route.endsWith("/versions")) return { data: options.versions ?? [] };
      return workspace;
    },
    put: async (route: string, body: unknown) => {
      sent.push({ method: "PUT", path: route, body });
      return row;
    },
    del: async (route: string) => {
      sent.push({ method: "DELETE", path: route });
      return { data: [] };
    },
  } as never;
  return { sent, ...fakeContext(api, options) };
}

const input = (overrides: Partial<InstallInput> = {}): InstallInput => ({
  workspace: "42",
  org: "7",
  disable: false,
  remove: false,
  yes: false,
  ...overrides,
});

test("with no entrypoint it lists what's installed, and where", async () => {
  const { ctx, calls, sent } = setup();
  await runWorkspaceInstall(ctx, input());
  const list = calls.find((call) => call.method === "list")?.value as { items: { label: string; meta: string }[] };
  assert.equal(list.items[0]?.meta, "user.panel@1, app 9, on, position 0");
  assert.equal(list.items[1]?.meta, "user.panel@1, the whole organization, off, position 0");
  assert.deepEqual(sent, []);
  const json = setup({ json: true });
  await runWorkspaceInstall(json.ctx, input());
  assert.equal((json.data[0] as { data: unknown[] }).data.length, 2);
});

test("flags that need an entrypoint say so", async () => {
  for (const flags of [{ remove: true }, { disable: true }, { app: "9" }, { position: 1 }]) {
    const { ctx } = setup();
    await assert.rejects(runWorkspaceInstall(ctx, input(flags)), /Say which entrypoint/);
  }
});

test("it installs for the organization, or one app, and can turn it off", async () => {
  const org = setup();
  await runWorkspaceInstall(org.ctx, input({ entrypoint: "panel", position: 3 }));
  assert.deepEqual(org.sent[0], {
    method: "PUT",
    path: "/v2/workspaces/42/installations",
    body: { entrypoint_id: "panel", application_id: null, enabled: true, position: 3 },
  });
  assert.match(org.said("success").join(), /Installed `panel` for the whole organization/);

  const app = setup();
  await runWorkspaceInstall(app.ctx, input({ entrypoint: "panel", app: "9", disable: true }));
  assert.deepEqual(app.sent[0]?.body, { entrypoint_id: "panel", application_id: 9, enabled: false });
  assert.match(app.said("success").join(), /Turned `panel` off for app 9/);

  const json = setup({ json: true });
  await runWorkspaceInstall(json.ctx, input({ entrypoint: "panel" }));
  assert.deepEqual(json.data[0], row);
});

test("removing confirms, or needs --yes without a terminal", async () => {
  const refused = setup();
  await assert.rejects(runWorkspaceInstall(refused.ctx, input({ entrypoint: "panel", remove: true })), /Pass --yes/);
  assert.deepEqual(refused.sent, []);

  const no = setup({ interactive: true, mode: "rich", confirm: false });
  await runWorkspaceInstall(no.ctx, input({ entrypoint: "panel", remove: true }));
  assert.deepEqual(no.sent, []);
  assert.match(no.said("outro").join(), /Nothing was removed/);

  const yes = setup({ interactive: true, mode: "rich", confirm: true });
  await runWorkspaceInstall(yes.ctx, input({ entrypoint: "panel", remove: true, app: "9" }));
  assert.equal(yes.sent[0]?.path, "/v2/workspaces/42/installations?entrypoint_id=panel&application_id=9");

  const forced = setup({ json: true });
  await runWorkspaceInstall(forced.ctx, input({ entrypoint: "panel", remove: true, yes: true }));
  assert.equal(forced.sent[0]?.path, "/v2/workspaces/42/installations?entrypoint_id=panel");
  assert.deepEqual(forced.data[0], { data: [] });

  const text = setup();
  await runWorkspaceInstall(text.ctx, input({ entrypoint: "panel", remove: true, yes: true }));
  assert.match(text.said("success").join(), /Removed `panel` from the whole organization/);
});

test("list uses --org, then the project's organization, then asks", async () => {
  const { ctx, calls } = setup();
  await runWorkspaceList(ctx, { org: "7" });
  const list = calls.find((call) => call.method === "list")?.value as { items: { label: string; meta: string }[] };
  assert.deepEqual(list.items, [{ label: "Churn", meta: "churn, id 42, active" }]);

  const root = scratch();
  fs.writeFileSync(path.join(root, "superwall.workspace.json"), JSON.stringify({ workspace_id: 42, organization_id: 8, slug: "churn" }));
  const fromProject = setup({ json: true });
  await runWorkspaceList(fromProject.ctx, { dir: root });
  assert.equal((fromProject.data[0] as { data: unknown[] }).data.length, 1);

  const asks = setup();
  await assert.rejects(runWorkspaceList(asks.ctx, { dir: scratch() }), /--org <id>|organizations/);
});

test("open prints the workspace's page, or an entrypoint in an app, and opens it only at a terminal", async () => {
  const opened: string[] = [];
  const open = async (url: string) => (opened.push(url), true);
  const text = setup();
  await runWorkspaceOpen(text.ctx, { workspace: "42", open: true }, { open });
  assert.match(text.said("info").join(), /https:\/\/app\.superwall\.com\/7\/workspaces\/churn/);
  assert.deepEqual(opened, []);

  const rich = setup({ interactive: true, mode: "rich" });
  await runWorkspaceOpen(rich.ctx, { workspace: "42", open: true, entrypoint: "panel", app: "9" }, { open });
  assert.deepEqual(opened, ["https://app.superwall.com/7/9/apps/42/panel"]);

  const off = setup({ interactive: true, mode: "rich" });
  await runWorkspaceOpen(off.ctx, { workspace: "42", open: false }, { open });
  assert.equal(opened.length, 1);

  const json = setup({ json: true });
  await runWorkspaceOpen(json.ctx, { workspace: "42", open: true });
  assert.deepEqual(json.data[0], { url: "https://app.superwall.com/7/workspaces/churn" });

  const noApp = setup();
  await assert.rejects(runWorkspaceOpen(noApp.ctx, { workspace: "42", open: true, entrypoint: "panel" }), /--app/);
});

test("open <entrypoint> --app goes where that entrypoint shows", async () => {
  const manifest = {
    name: "x",
    scopes: [],
    entrypoints: [
      { id: "count", slot: "chart.source@1", title: "C" },
      { id: "card", slot: "app.dashboard.widget@1", title: "W" },
    ],
  };
  const open = async (entrypoint: string) => {
    const { ctx, said } = setup({ versions: [{ id: 3, manifest }] });
    await runWorkspaceOpen(ctx, { workspace: "42", open: false, entrypoint, app: "9" });
    return said("info").join();
  };
  assert.match(await open("count"), /\/9\/charts\?cS=workspaces/);
  assert.match(await open("card"), /\/9\/embeds/);
});

test("open on an app-only workspace goes to the app route", async () => {
  const manifest = { name: "x", scopes: [], entrypoints: [{ id: "cohorts", slot: "app.page@1", title: "C", path: "/" }] };
  const { ctx, said } = setup({ versions: [{ id: 3, manifest }], projects: [{ id: 1, applications: [{ id: 9, name: "Pets" }] }] });
  await runWorkspaceOpen(ctx, { workspace: "42", open: false });
  assert.match(said("info").join(), /\/9\/apps\/\d+\/cohorts/);
});
