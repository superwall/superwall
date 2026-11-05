import assert from "node:assert/strict";
import { test } from "node:test";
import { awaitingInstall, openLink, visibilityOf } from "@/core/workspaces/resolve";
import { recordingRenderer } from "../../helpers/renderer";

const workspace = { id: 42, organization_id: 7, slug: "churn" };
const entry = (id: string, slot: string) => ({ id, slot, title: id });
const manifest = (...entrypoints: ReturnType<typeof entry>[]) => ({ entrypoints });
const projects = [{ id: 1, applications: [{ id: 9, name: "Pets" }, { id: 10, name: "Cats" }] }];

function context(api: Record<string, unknown> = {}) {
  return {
    ui: recordingRenderer(),
    api: { host: "https://api.superwall.com", list: async () => projects, ...api },
  } as never;
}

test("each kind of workspace links to where it opens", async () => {
  const link = (...entrypoints: ReturnType<typeof entry>[]) => openLink(context(), workspace, manifest(...entrypoints));
  const app = "https://app.superwall.com/7/9";
  assert.equal((await link(entry("home", "org.page@1"), entry("page", "app.page@1"))).url, "https://app.superwall.com/7/workspaces/churn");
  assert.equal((await link(entry("page", "app.page@1"), entry("count", "chart.source@1"))).url, `${app}/apps/42/page`);
  for (const slot of ["app.dashboard.widget@1", "campaign.tab@1", "campaign.metric@1", "user.panel@1", "user.action@1"]) {
    const found = await link(entry("thing", slot), entry("count", "chart.source@1"));
    assert.equal(found.url, `${app}/embeds`, slot);
    assert.equal(found.app, "Pets");
    assert.equal(found.otherApps, true);
  }
  assert.equal((await link(entry("count", "chart.source@1"))).url, `${app}/charts?cS=workspaces`);
});

test("with nothing to link to, or no app to link in, it's the workspace's own page", async () => {
  const own = "https://app.superwall.com/7/workspaces/churn";
  assert.equal((await openLink(context(), workspace, null)).url, own);
  assert.equal((await openLink(context(), workspace, manifest())).url, own);
  const noApps = context({ list: async () => [] });
  assert.equal((await openLink(noApps, workspace, manifest(entry("count", "chart.source@1")))).url, own);
  const failing = context({ list: async () => Promise.reject(new Error("down")) });
  assert.equal((await openLink(failing, workspace, manifest(entry("count", "chart.source@1")))).url, own);
});

const installs = (rows: unknown[] | Error) => ({
  get: async () => {
    if (rows instanceof Error) throw rows;
    return { data: rows };
  },
});

test("an approved version is waiting only until any entrypoint has an install row, in any state", async () => {
  const api = (rows: unknown[] | Error) => installs(rows) as never;
  const metric = manifest(entry("count", "chart.source@1"), entry("card", "app.dashboard.widget@1"));
  assert.equal(await awaitingInstall(api([]), 42, metric), true);
  assert.equal(await awaitingInstall(api([{ entrypoint_id: "other" }]), 42, metric), true);
  assert.equal(await awaitingInstall(api([{ entrypoint_id: "count", enabled: false }]), 42, metric), false);
  assert.equal(await awaitingInstall(api([]), 42, manifest(entry("home", "org.page@1"), entry("count", "chart.source@1"))), false, "an org.page needs no install");
  assert.equal(await awaitingInstall(api([]), 42, null), false);
  assert.equal(await awaitingInstall(api(new Error("down")), 42, metric), false);
});

test("a re-push of an approved version with nothing installed isn't called live", async () => {
  const active = { id: 42, state: "active", active_version_id: 5, author_version_id: null };
  const get = (rows: unknown[]) => async (route: string) => {
    if (route.endsWith("/installations")) return { data: rows };
    if (route === "/v2/me") return { role: "CUSTOMER" };
    return active;
  };
  const metric = manifest(entry("count", "chart.source@1"));
  const waiting = await visibilityOf(context({ get: get([]) }), 42, 5, metric);
  assert.equal(waiting.visibleTo, "its_author");
  assert.match(waiting.sentence, /nothing is installed yet, so only its author can see it, marked "Not installed"/);
  const live = await visibilityOf(context({ get: get([{ entrypoint_id: "count" }]) }), 42, 5, metric);
  assert.equal(live.visibleTo, "everyone");
  assert.equal(live.sentence, "Version 5 is live.");
});
