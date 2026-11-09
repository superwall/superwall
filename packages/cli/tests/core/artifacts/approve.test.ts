import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "@/core/api/client";
import { diffSides, runArtifactApprove, sideOf, type ApproveInput } from "@/core/artifacts/approve";
import type { Artifact, ArtifactVersion } from "@/core/artifacts/api";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeBinding } from "@/core/artifacts/binding";
import { fakeContext } from "./fake-api";

const bound = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-approve-"));
  writeBinding(root, { artifactId: "42", organizationId: "7", slug: "churn" });
  return root;
};

const entrypoint = { id: "home", slot: "org.page@1", title: "Home", path: "/" };
const manifest = (overrides: Record<string, unknown> = {}) => ({
  name: "Churn",
  scopes: ["data:read"],
  entrypoints: [entrypoint],
  ...overrides,
});

const version = (id: number, overrides: Partial<ArtifactVersion> = {}): ArtifactVersion => ({
  id,
  artifact_id: 42,
  commit_sha: `${id}`.padEnd(40, "a"),
  commit_message: `push ${id}\n\nbody`,
  build_status: "SUCCEEDED",
  build_error: null,
  manifest: manifest() as never,
  compatibility_date: "2026-09-01",
  compatibility_flags: [],
  deploy_requested_at: null,
  created_at: "2026-11-05T00:00:00Z",
  grant: null,
  ...overrides,
});

const grantOf = (scopes: string[], egress: string[] = []) => ({ scopes, background_scopes: [], egress, secret_bindings: [] });

function setup(
  versions: ArtifactVersion[],
  options: Parameters<typeof fakeContext>[1] = {},
  active: number | null = null,
  extra: { role?: string; onApprove?: () => never } = {},
) {
  const posts: string[] = [];
  const artifact: Artifact = { id: 42, organization_id: 7, slug: "churn", name: "Churn", state: "not_approved", active_version_id: active };
  const api = {
    get: async (path: string) => {
      if (path === "/v2/me/organizations") return { data: extra.role ? [{ id: 7, role: extra.role }] : [] };
      if (path.endsWith("/installations")) return { data: [] };
      return path.endsWith("/versions") ? { data: versions } : artifact;
    },
    post: async (path: string) => {
      posts.push(path);
      extra.onApprove?.();
      return { id: 1 };
    },
  } as never;
  return { posts, ...fakeContext(api, options) };
}

const input = (overrides: Partial<ApproveInput> = {}): ApproveInput => ({ artifact: "42", yes: false, acceptChanges: false, ...overrides });

const wider = version(2, { manifest: manifest({ scopes: ["data:read", "users:read"], egress: ["hooks.slack.com:443"] }) as never });
const live = version(1, { grant: grantOf(["data:read"]) });

test("it shows the manifest and the diff before it asks, and a no asks nothing further", async () => {
  const { ctx, posts, said, calls } = setup([wider, live], { interactive: true, mode: "rich", confirm: false }, 1);
  await runArtifactApprove(ctx, input());
  const report = said("report").join("\n");
  assert.match(report, /What it can do:\nScopes:\n  data:read\n  users:read\nOutside hosts:\n  hooks\.slack\.com:443/);
  assert.match(report, /Changes from the live version, 1:\nScopes:\n  \+ users:read\nOutside hosts:\n  \+ hooks\.slack\.com:443/);
  const order = calls.map((call) => call.method);
  assert.ok(order.indexOf("report") < order.indexOf("confirm"));
  assert.deepEqual(posts, []);
  assert.match(said("outro").join(), /Nothing was approved/);
});

test("a compatibility change is shown beside the manifest, and has to be accepted", async () => {
  const newer = version(2, { compatibility_date: "2026-10-01", compatibility_flags: ["nodejs_compat"] });
  const shown = setup([newer, live], {}, 1);
  await runArtifactApprove(shown.ctx, input({ yes: true }));
  const report = shown.said("report").join("\n");
  assert.match(report, /What it can do:[\s\S]*Compatibility:\n  date 2026-10-01\n  flag nodejs_compat/);
  assert.match(report, /Changes from the live version, 1:[\s\S]*Compatibility:\n  \+ date 2026-10-01\n  \+ flag nodejs_compat\n  - date 2026-09-01/);
  assert.deepEqual(shown.posts, []);
  assert.match(shown.said("error").join(), /--accept-changes/);

  const json = setup([newer, live], { json: true }, 1);
  await runArtifactApprove(json.ctx, input());
  const [answer] = json.data as [{ compatibility_date: string; compatibility_flags: string[]; diff: { section: string }[] }];
  assert.equal(answer.compatibility_date, "2026-10-01");
  assert.deepEqual(answer.compatibility_flags, ["nodejs_compat"]);
  assert.deepEqual(answer.diff.map((section) => section.section), ["compatibility"]);

  const same = setup([version(2), live], {}, 1);
  await runArtifactApprove(same.ctx, input({ yes: true }));
  assert.deepEqual(same.posts, ["/v2/artifacts/42/versions/2/approve"], "the same date and flags are no change");

  const bare = version(2, { compatibility_date: null, compatibility_flags: undefined as never });
  assert.deepEqual(sideOf(bare, false).compatibility, []);
});

test("a member who can't approve reads it, gets the API's sentence with no prompt, and nothing is posted", async () => {
  const sentence = "Only organization owners and admins can approve artifact versions. Ask one of them to review this version.";
  for (const role of ["USER", "EDITOR"]) {
    const { ctx, posts, said, calls, failed } = setup([wider, live], { interactive: true, mode: "rich", confirm: true }, 1, { role });
    await runArtifactApprove(ctx, input());
    assert.ok(said("report").join().includes("What it can do"));
    assert.equal(calls.filter((call) => call.method === "confirm").length, 0);
    assert.deepEqual(posts, []);
    assert.equal(said("error").join(), sentence);
    assert.match(said("info").join(), /artifacts share/);
    assert.equal(failed(), 1);
  }
  const json = setup([wider, live], { json: true }, 1, { role: "USER" });
  await runArtifactApprove(json.ctx, input({ yes: true, acceptChanges: true }));
  assert.equal((json.data[0] as { reason: string }).reason, "needs_admin");
  assert.equal(json.failed(), 1);
});

test("owners and admins are asked as before, and a 403 from the API shows its own words", async () => {
  for (const role of ["OWNER", "ADMIN"]) {
    const { ctx, posts } = setup([wider, live], { interactive: true, mode: "rich", confirm: true }, 1, { role });
    await runArtifactApprove(ctx, input());
    assert.equal(posts.length, 1);
  }
  const restricted = "Only owners and admins with access to all projects can approve artifact versions, because an artifact reaches every project. Ask an owner to change your project access.";
  const refusing = (): never => {
    throw new ApiError("POST approve", 403, JSON.stringify({ message: restricted }));
  };
  const { ctx, said, failed } = setup([wider, live], { interactive: true, mode: "rich", confirm: true }, 1, { role: "ADMIN", onApprove: refusing });
  await runArtifactApprove(ctx, input());
  assert.equal(said("error").join(), restricted);
  assert.equal(failed(), 1);

  const json = setup([wider, live], { json: true }, 1, { onApprove: refusing });
  await runArtifactApprove(json.ctx, input({ yes: true, acceptChanges: true }));
  assert.equal((json.data[0] as { reason: string }).reason, "forbidden");

  const other = setup([wider, live], {}, 1, {
    onApprove: () => {
      throw new ApiError("POST approve", 503, JSON.stringify({ message: "Down" }));
    },
  });
  await assert.rejects(runArtifactApprove(other.ctx, input({ yes: true, acceptChanges: true })), /Down/);
});

test("the report shows the push's note, not the generic subject", async () => {
  const noted = version(2, { commit_message: "push artifact/churn\n\nAdd the cohort page\n\nSuperwall-Artifact: 42\nSuperwall-Cli: 2.5.0\n" });
  const first = setup([noted, live], {}, 1);
  await runArtifactApprove(first.ctx, input());
  assert.match(first.said("report").join(), /\nAdd the cohort page\n/);
  const colon = version(2, { commit_message: "push artifact/churn\n\nFix: correct cohort counts\n\nSuperwall-Artifact: 42\n" });
  const fourth = setup([colon, live], {}, 1);
  await runArtifactApprove(fourth.ctx, input());
  assert.match(fourth.said("report").join(), /\nFix: correct cohort counts\n/);
  const bare = version(2, { commit_message: "push artifact/churn\n\nSuperwall-Artifact: 42\n" });
  const second = setup([bare, live], {}, 1);
  await runArtifactApprove(second.ctx, input());
  assert.match(second.said("report").join(), /\npush artifact\/churn\n/);
  const mine = version(2, { commit_message: "Fix the chart\n\nLonger body" });
  const third = setup([mine, live], {}, 1);
  await runArtifactApprove(third.ctx, input());
  assert.match(third.said("report").join(), /\nFix the chart\n/);
});

test("approving something with nothing installed says only its author can see it", async () => {
  const metricOnly = manifest({ entrypoints: [{ id: "count", slot: "chart.source@1", title: "C", metric: {} }] });
  const { ctx, said } = setup([version(2, { manifest: metricOnly as never })], { interactive: true, mode: "rich", confirm: true }, null);
  await runArtifactApprove(ctx, input());
  assert.match(said("success").join(), /Nothing is installed yet, so only its author can see it until you choose where it shows/);
});

test("approving a metric that isn't installed says Charts won't show it, and how to install it", async () => {
  const charted = manifest({
    entrypoints: [
      entrypoint,
      { id: "transactions", slot: "chart.source@1", title: "Transactions", metric: {} },
      { id: "card", slot: "app.dashboard.widget@1", title: "Card", path: "/card" },
      { id: "custom", slot: "future.slot@9", title: "", path: "/x" },
    ],
  });
  const installed = [{ entrypoint_id: "card", slot: "app.dashboard.widget@1", application_id: 5, enabled: true, position: 0 }];
  const run = (projects: unknown[], json = false, ref: Partial<ApproveInput> = {}) => {
    const { ctx, said, data, posts } = setup([version(2, { manifest: charted as never })], { interactive: !json, mode: json ? "json" : "rich", confirm: true, json }, null);
    const api = (ctx as any).api;
    const get = api.get;
    api.get = async (path: string) => (path.endsWith("/installations") ? { data: installed } : get(path));
    api.list = async () => projects;
    return runArtifactApprove(ctx, input({ yes: true, acceptChanges: true, ...ref })).then(() => ({ said, data, posts }));
  };

  const oneApp = await run([{ id: 1, applications: [{ id: 5, name: "Fit" }] }]);
  assert.deepEqual(oneApp.said("info"), [
    'Charts won\'t show "Transactions" until you install it: superwall artifacts install transactions --app 5 --artifact 42',
    '"custom" won\'t show until you install it: superwall artifacts install custom --app 5 --artifact 42',
  ]);

  const inProject = await run([{ id: 1, applications: [{ id: 5 }, { id: 6 }] }], false, { artifact: undefined, dir: bound() });
  assert.match(inProject.said("info")[0]!, /: superwall artifacts install transactions --app <app-id>$/);

  const json = await run([], true);
  const [answer] = json.data as [{ not_installed: unknown[] }];
  assert.deepEqual(answer.not_installed, [
    { entrypoint_id: "transactions", slot: "chart.source@1", command: "superwall artifacts install transactions --app <app-id> --artifact 42" },
    { entrypoint_id: "custom", slot: "future.slot@9", command: "superwall artifacts install custom --app <app-id> --artifact 42" },
  ]);
});

test("installations that can't be read claim nothing", async () => {
  const metricOnly = manifest({ entrypoints: [{ id: "count", slot: "chart.source@1", title: "C", metric: {} }] });
  const { ctx, said } = setup([version(2, { manifest: metricOnly as never })], { interactive: true, mode: "rich", confirm: true }, null);
  const api = (ctx as any).api;
  const get = api.get;
  api.get = async (path: string) => {
    if (path.endsWith("/installations")) throw new Error("down");
    return get(path);
  };
  await runArtifactApprove(ctx, input());
  assert.deepEqual(said("info"), ["Choose where it shows with `superwall artifacts install <entrypoint> --artifact 42`."]);
});

test("a yes in a terminal approves, and points at install", async () => {
  const { ctx, posts, said } = setup([wider, live], { interactive: true, mode: "rich", confirm: true }, 1);
  await runArtifactApprove(ctx, input());
  assert.deepEqual(posts, ["/v2/artifacts/42/versions/2/approve"]);
  assert.match(said("info").join(), /artifacts install/);
});

test("--yes in a terminal still asks when what it can do changes", async () => {
  const { ctx, said, posts } = setup([wider, live], { interactive: true, mode: "rich", confirm: false }, 1);
  await runArtifactApprove(ctx, input({ yes: true }));
  assert.ok(said("confirm").length === 1);
  assert.deepEqual(posts, []);
  const accepted = setup([wider, live], { interactive: true, mode: "rich", confirm: false }, 1);
  await runArtifactApprove(accepted.ctx, input({ yes: true, acceptChanges: true }));
  assert.equal(accepted.said("confirm").length, 0);
  assert.equal(accepted.posts.length, 1);
});

test("--json never approves on its own, and prints what it would have", async () => {
  const { ctx, posts, data, failed } = setup([wider, live], { json: true }, 1);
  await runArtifactApprove(ctx, input());
  assert.deepEqual(posts, []);
  const out = data[0] as { approved: boolean; reason: string; diff: { section: string; added: string[] }[]; manifest: unknown };
  assert.equal(out.approved, false);
  assert.equal(out.reason, "needs_yes");
  assert.deepEqual(out.diff.map((section) => [section.section, section.added]), [["scopes", ["users:read"]], ["egress", ["hooks.slack.com:443"]]]);
  assert.ok(out.manifest);
  assert.equal(failed(), 1);
});

test("--json --yes won't pass a scope change without --accept-changes", async () => {
  const { ctx, posts, data, failed } = setup([wider, live], { json: true }, 1);
  await runArtifactApprove(ctx, input({ yes: true }));
  assert.deepEqual(posts, []);
  assert.equal((data[0] as { reason: string }).reason, "needs_accept_changes");
  assert.equal(failed(), 1);

  const accepted = setup([wider, live], { json: true }, 1);
  await runArtifactApprove(accepted.ctx, input({ yes: true, acceptChanges: true }));
  assert.equal(accepted.posts.length, 1);
  assert.equal((accepted.data[0] as { approved: boolean }).approved, true);
  assert.ok((accepted.data[0] as { diff: unknown[] }).diff.length > 0, "the changes are in the record");
});

test("no terminal and no flags: refuses in text too", async () => {
  const none = setup([wider, live], {}, 1);
  await runArtifactApprove(none.ctx, input());
  assert.deepEqual(none.posts, []);
  assert.match(none.said("error").join(), /pass --yes/);
  const yes = setup([wider, live], {}, 1);
  await runArtifactApprove(yes.ctx, input({ yes: true }));
  assert.deepEqual(yes.posts, []);
  assert.match(yes.said("error").join(), /--accept-changes/);
});

test("--yes passes alone only when nothing it can do changes", async () => {
  const same = version(2);
  const { ctx, posts, said } = setup([same, live], {}, 1);
  await runArtifactApprove(ctx, input({ yes: true }));
  assert.equal(posts.length, 1);
  assert.match(said("report").join(), /Nothing it can do changes/);
});

test("the first approval counts everything as new", async () => {
  const { ctx, posts, said } = setup([version(1)], {}, null);
  await runArtifactApprove(ctx, input({ yes: true }));
  assert.deepEqual(posts, []);
  assert.match(said("report").join(), /Nothing is live yet, so all of this is new:\nScopes:\n  \+ data:read/);
});

test("the diff is against what's granted: a revoked grant makes every scope new again", async () => {
  const revoked = version(1, { grant: null });
  const { ctx, said, posts } = setup([version(2), revoked], {}, 1);
  await runArtifactApprove(ctx, input({ yes: true }));
  assert.deepEqual(posts, []);
  assert.match(said("report").join(), /\+ data:read/);
});

test("a live version with its grant intact is left alone; with a revoked one it can be approved again", async () => {
  const { ctx, posts, said, data } = setup([live], {}, 1);
  await runArtifactApprove(ctx, input({ version: "1", yes: true }));
  assert.deepEqual(posts, []);
  assert.match(said("info").join(), /already live/);
  void data;
  const json = setup([live], { json: true }, 1);
  await runArtifactApprove(json.ctx, input({ version: "1" }));
  assert.equal((json.data[0] as { reason: string }).reason, "already_active");

  const revoked = setup([version(1)], { interactive: true, mode: "rich", confirm: true }, 1);
  await runArtifactApprove(revoked.ctx, input({ version: "1" }));
  assert.equal(revoked.posts.length, 1);
});

test("only a built version can be approved, and the default skips what's live or failed", async () => {
  const building = setup([version(3, { build_status: "BUILDING", manifest: null })]);
  await assert.rejects(runArtifactApprove(building.ctx, input({ version: "3" })), /is building/);
  const none = setup([version(3, { build_status: "FAILED", manifest: null })]);
  await assert.rejects(runArtifactApprove(none.ctx, input()), /has no version for this yet/);
  const unknown = setup([live], {}, 1);
  await assert.rejects(runArtifactApprove(unknown.ctx, input({ version: "9" })), /No version 9/);
  const picks = setup([version(4, { build_status: "FAILED", manifest: null }), version(3), live], { interactive: true, mode: "rich", confirm: true }, 1);
  await runArtifactApprove(picks.ctx, input());
  assert.deepEqual(picks.posts, ["/v2/artifacts/42/versions/3/approve"]);
});

test("every kind of authority shows up in a diff", () => {
  const rich = version(2, {
    manifest: manifest({
      scopes: ["users:read"],
      background: { scopes: ["data:read"] },
      egress: ["a.example.com:443"],
      secrets: [{ name: "KEY", host: "a.example.com", inject: "url" }],
      storage: { sql: true, kv: true },
      crons: [{ name: "daily", schedule: "0 9 * * *" }],
      events: ["subscription.renewed"],
      entrypoints: [entrypoint, { id: "m", slot: "chart.source@1", title: "M", metric: { value_type: "number" } }],
    }) as never,
  });
  const diff = diffSides(sideOf(live, true), sideOf(rich, false));
  assert.deepEqual(diff.map((section) => section.section), ["scopes", "backgroundScopes", "egress", "secrets", "entrypoints", "crons", "events", "storage"]);
  assert.deepEqual(diff[0], { section: "scopes", title: "Scopes", added: ["users:read"], removed: ["data:read"] });
  assert.ok(diff[3]?.added[0]?.includes("KEY to a.example.com (\"url\")"));
  assert.deepEqual(diffSides(sideOf(rich, false), sideOf(rich, false)), []);
  assert.deepEqual(sideOf(undefined, true).scopes, []);
  assert.deepEqual(sideOf(version(1, { manifest: null }), false).scopes, []);
});

test("a changed entrypoint path or title is a change", () => {
  const moved = version(2, { manifest: manifest({ entrypoints: [{ ...entrypoint, path: "/moved" }] }) as never });
  const diff = diffSides(sideOf(live, true), sideOf(moved, false));
  assert.equal(diff[0]?.section, "entrypoints");
  assert.equal(diff[0]?.added.length, 1);
  assert.equal(diff[0]?.removed.length, 1);
});

test("free text in a manifest can't read the same as something else it could say", () => {
  const withEntrypoint = (entrypoint: object) => version(2, { manifest: manifest({ entrypoints: [entrypoint] }) as never });
  const metric = (values: string[]) => ({
    id: "m",
    slot: "chart.source@1",
    title: "M",
    metric: { filters: [{ key: "store", name: "F", values: values.map((value) => ({ value, label: value })) }] },
  });
  const changes = (before: object, after: object) => diffSides(sideOf(withEntrypoint(before), false), sideOf(withEntrypoint(after), false));

  assert.equal(changes(metric(["A, B"]), metric(["A", "B"]))[0]?.section, "entrypoints", "a value with a comma");
  const page = { id: "p", slot: "app.page@1", title: "T", path: "/x" };
  assert.equal(changes(page, { ...page, title: 'T" at "/y', path: "/x" })[0]?.section, "entrypoints");
  assert.equal(changes({ ...page, title: 'T" metric: "number' }, { ...page, metric: { value_type: "number" } })[0]?.section, "entrypoints");
});

test("a metric reads plainly, and a new breakdown or filter value is a change", () => {
  const metric = (filters: string[], breakdowns: string[] = []) =>
    version(2, {
      manifest: manifest({
        entrypoints: [
          {
            id: "m",
            slot: "chart.source@1",
            title: "M",
            metric: {
              value_type: "percentage",
              breakdowns: breakdowns.map((key) => ({ key, name: key })),
              filters: [{ key: "store", name: "Store", values: filters.map((value) => ({ value, label: value })) }],
            },
          },
        ],
      }) as never,
    });
  const base = sideOf(metric(["A"]), false);
  assert.deepEqual(base.entrypoints, ['m: chart.source@1 "M" metric: percentage, filtered by store ("A")']);
  assert.equal(diffSides(base, sideOf(metric(["A", "B"]), false))[0]?.section, "entrypoints");
  assert.match(sideOf(metric(["A"], ["plan"]), false).entrypoints[0]!, /split by plan/);
  const bare = version(2, { manifest: manifest({ entrypoints: [{ id: "m", slot: "chart.source@1", title: "M", metric: {} }] }) as never });
  assert.match(sideOf(bare, false).entrypoints[0]!, /metric: number$/);
});
