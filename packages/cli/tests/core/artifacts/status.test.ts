import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "@/core/api/client";
import type { Artifact, ArtifactBuild, ArtifactVersion } from "@/core/artifacts/api";
import { runArtifactLogs, runArtifactShare, runArtifactStatus } from "@/core/artifacts/status";
import { fakeContext } from "./fake-api";

const artifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: 42,
  organization_id: 7,
  slug: "churn",
  name: "Churn",
  state: "not_approved",
  active_version_id: 1,
  author_version_id: 2,
  ...overrides,
});
const version = (id: number, overrides: Partial<ArtifactVersion> = {}): ArtifactVersion => ({
  id,
  artifact_id: 42,
  commit_sha: `${id}`.padEnd(40, "a"),
  commit_message: null,
  build_status: "SUCCEEDED",
  build_error: null,
  manifest: null,
  compatibility_date: null,
  compatibility_flags: [],
  deploy_requested_at: null,
  created_at: "2026-11-05T00:00:00Z",
  grant: null,
  ...overrides,
});
const build = (id: number, overrides: Partial<ArtifactBuild> = {}): ArtifactBuild => ({
  artifact_id: 42,
  version_id: id,
  commit_sha: "a",
  status: "succeeded",
  step: null,
  failure: null,
  steps: [],
  queued_at: null,
  started_at: null,
  finished_at: null,
  log: "line one\nline two\n",
  version: version(id),
  ...overrides,
});

function setup(versions: ArtifactVersion[], options: { build?: ArtifactBuild | Error; json?: boolean; artifact?: Artifact } = {}) {
  const posts: string[] = [];
  const reads: string[] = [];
  const api = {
    host: "https://api.superwall.com",
    list: async () => [{ id: 1, applications: [{ id: 9, name: "Pets" }] }],
    get: async (path: string) => {
      reads.push(path);
      if (path.endsWith("/build")) {
        if (options.build instanceof Error) throw options.build;
        return options.build ?? build(versions[0]!.id);
      }
      if (path.endsWith("/versions")) return { data: versions };
      if (path.endsWith("/installations")) return { data: [] };
      if (path.startsWith("/v2/artifacts?")) return { data: [options.artifact ?? artifact()] };
      return options.artifact ?? artifact();
    },
    post: async (path: string) => {
      posts.push(path);
      return version(2);
    },
  } as never;
  return { posts, reads, ...fakeContext(api, { json: options.json ?? false }) };
}

test("status shows the state, where to open it and each version's role, newest first", async () => {
  const { ctx, said, calls, reads } = setup([version(1), version(2, { deploy_requested_at: "2026-11-05T00:00:00Z" })]);
  await runArtifactStatus(ctx, { artifact: "42" });
  assert.match(said("success").join(), /Churn \(`churn`, id 42\): Waiting for an admin/);
  assert.match(said("info").join(), /https:\/\/app\.superwall\.com\/7\/artifacts\/churn/);
  const list = calls.find((call) => call.method === "list")?.value as { items: { label: string; meta: string }[] };
  assert.deepEqual(list.items.map((item) => item.label), ["Version 2", "Version 1"]);
  assert.match(list.items[0]!.meta, /succeeded, yours until approved, review requested/);
  assert.match(list.items[1]!.meta, /active/);
  assert.ok(!reads.some((path) => path.endsWith("/build")), "a finished version isn't re-read");
});

test("status settles an unfinished build by reading it", async () => {
  const pending = version(2, { build_status: "BUILDING" });
  const { ctx, reads, said, calls } = setup([version(1), pending], { build: build(2, { status: "running", step: "install", version: pending }) });
  await runArtifactStatus(ctx, { artifact: "42" });
  assert.ok(reads.includes("/v2/artifacts/42/versions/2/build"));
  assert.match(said("info").join(), /Version 2 is at install/);
  void calls;
  const settled = version(2, { build_status: "SUCCEEDED" });
  const done = setup([pending], { build: build(2, { version: settled }) });
  await runArtifactStatus(done.ctx, { artifact: "42" });
  const list = done.calls.find((call) => call.method === "list")?.value as { items: { meta: string }[] };
  assert.match(list.items[0]!.meta, /succeeded/);
});

test("status survives a build it can't read, and passes on other errors", async () => {
  const pending = version(2, { build_status: "PENDING" });
  const quiet = setup([pending], { build: new ApiError("GET", 403, JSON.stringify({ message: "no" })) });
  await runArtifactStatus(quiet.ctx, { artifact: "42" });
  assert.equal(quiet.failed(), 0);
  const loud = setup([pending], { build: new ApiError("GET", 500, JSON.stringify({ message: "boom" })) });
  await assert.rejects(runArtifactStatus(loud.ctx, { artifact: "42" }), /boom/);
});

test("status shows the latest few and the live one, and --all shows the rest", async () => {
  const many = [1, 2, 3, 4, 5, 6, 7].map((id) => version(id));
  const labels = (calls: { method: string; value?: unknown }[]) =>
    (calls.find((call) => call.method === "list")?.value as { items: { label: string; meta: string }[] }).items.map((item) => item.label);
  const quiet = setup(many, { artifact: artifact({ active_version_id: 2, author_version_id: null }) });
  await runArtifactStatus(quiet.ctx, { artifact: "42" });
  assert.deepEqual(labels(quiet.calls), ["Version 7", "Version 6", "Version 5", "Version 2"]);
  assert.match(JSON.stringify(quiet.calls), /"label":"Version 2","meta":"[^"]*active/);
  assert.match(quiet.said("info").join(), /And 3 older versions\. See them all with --all\./);

  const all = setup(many, { artifact: artifact({ active_version_id: 2, author_version_id: null }) });
  await runArtifactStatus(all.ctx, { artifact: "42", all: true });
  assert.equal(labels(all.calls).length, 7);
  assert.doesNotMatch(all.said("info").join(), /older/);

  const one = setup([1, 2, 3, 4].map((id) => version(id)), { artifact: artifact({ active_version_id: 4, author_version_id: null }) });
  await runArtifactStatus(one.ctx, { artifact: "42" });
  assert.match(one.said("info").join(), /And 1 older version\./);
});

test("an app-only artifact's status links to the app route", async () => {
  const manifest = { name: "x", scopes: [], entrypoints: [{ id: "cohorts", slot: "app.page@1", title: "C", path: "/" }] };
  const context = setup([version(1, { manifest: manifest as never })]);
  (context.ctx as unknown as { api: { list: unknown } }).api.list = async () => [{ id: 1, applications: [{ id: 9, name: "Pets" }] }];
  await runArtifactStatus(context.ctx, { artifact: "42" });
  assert.match(context.said("info").join(), /\/7\/9\/apps\/42\/cohorts/);
});

test("status doesn't call an approved artifact with nothing installed live", async () => {
  const manifest = { name: "x", scopes: [], entrypoints: [{ id: "count", slot: "chart.source@1", title: "C" }] };
  const context = setup([version(1, { manifest: manifest as never })], { artifact: artifact({ state: "active", active_version_id: 1, author_version_id: null }) });
  await runArtifactStatus(context.ctx, { artifact: "42" });
  assert.match(context.said("success").join(), /Approved, but nothing is installed yet, so only its author can see it/);
  const json = setup([version(1, { manifest: manifest as never })], { json: true, artifact: artifact({ state: "active", active_version_id: 1, author_version_id: null }) });
  await runArtifactStatus(json.ctx, { artifact: "42" });
  assert.equal((json.data[0] as { awaiting_install: boolean }).awaiting_install, true);
});

test("status says why the latest build failed, and --json gives it all", async () => {
  const { ctx, said } = setup([version(2, { build_status: "FAILED", build_error: "no lockfile" })]);
  await runArtifactStatus(ctx, { artifact: "42" });
  assert.match(said("warn").join(), /Version 2 didn't build: no lockfile/);
  const unnamed = setup([version(2, { build_status: "FAILED" })]);
  await runArtifactStatus(unnamed.ctx, { artifact: "42" });
  assert.match(unnamed.said("warn").join(), /artifacts logs/);
  const empty = setup([], { artifact: artifact({ state: "no_version", active_version_id: null, author_version_id: null }) });
  await runArtifactStatus(empty.ctx, { artifact: "42" });
  assert.match(empty.said("success").join(), /Nothing pushed yet/);
  const json = setup([version(1)], { json: true });
  await runArtifactStatus(json.ctx, { artifact: "42" });
  assert.deepEqual(Object.keys(json.data[0] as object), ["artifact", "url", "versions", "build", "awaiting_install"]);
});

test("a slug needs its organization", async () => {
  const { ctx } = setup([]);
  await assert.rejects(runArtifactStatus(ctx, { artifact: "churn" }), /--org/);
  const found = setup([version(1)]);
  await runArtifactStatus(found.ctx, { artifact: "churn", org: "7" });
  assert.equal(found.failed(), 0);
  const missing = setup([]);
  (missing.ctx as any).api.get = async () => ({ data: [] });
  await assert.rejects(runArtifactStatus(missing.ctx, { artifact: "nope", org: "7" }), /No artifact `nope`/);
});

test("logs prints the build's log for the latest version, or the one asked for", async () => {
  const { ctx, text, reads } = setup([version(1), version(2)], { build: build(2) });
  await runArtifactLogs(ctx, { artifact: "42" });
  assert.deepEqual(text, ["line one\nline two\n"]);
  assert.ok(reads.includes("/v2/artifacts/42/versions/2/build"));
  const one = setup([version(1), version(2)], { build: build(1) });
  await runArtifactLogs(one.ctx, { artifact: "42", version: "1" });
  assert.ok(one.reads.includes("/v2/artifacts/42/versions/1/build"));
});

test("logs waits for the end of a build, says why it failed, and copes with no log", async () => {
  const running = setup([version(2)], { build: build(2, { status: "running", step: "install", log: null }) });
  await runArtifactLogs(running.ctx, { artifact: "42" });
  assert.match(running.said("info").join(), /still building, at install.*once it finishes/);
  const queued = setup([version(2)], { build: build(2, { status: "queued", log: null }) });
  await runArtifactLogs(queued.ctx, { artifact: "42" });
  assert.match(queued.said("info").join(), /still building\./);
  const failed = setup([version(2)], { build: build(2, { status: "failed", failure: { code: "x", message: "bad bundle" } }) });
  await runArtifactLogs(failed.ctx, { artifact: "42" });
  assert.match(failed.said("error").join(), /bad bundle/);
  assert.equal(failed.text.length, 1);
  const none = setup([version(2)], { build: build(2, { log: null }) });
  await runArtifactLogs(none.ctx, { artifact: "42" });
  assert.match(none.said("info").join(), /no build log/);
  const json = setup([version(2)], { build: build(2), json: true });
  await runArtifactLogs(json.ctx, { artifact: "42" });
  assert.equal((json.data[0] as { log: string }).log, "line one\nline two\n");
});

test("share asks for review of the latest built version, and says who sees it", async () => {
  const { ctx, posts, said } = setup([version(1), version(2), version(3, { build_status: "FAILED" })]);
  await runArtifactShare(ctx, { artifact: "42" });
  assert.deepEqual(posts, ["/v2/artifacts/42/versions/2/request-deploy"]);
  assert.match(said("success").join(), /marked for review\. Only you can see version 2 until an admin approves it/);
  assert.match(said("info").join(), /artifacts approve 2 --artifact 42/);
  const json = setup([version(2)], { json: true });
  await runArtifactShare(json.ctx, { artifact: "42" });
  assert.equal(json.data.length, 1);
});

test("share tells a member who can't approve who to ask, when that's knowable", async () => {
  const member = (name: string | null, email: string | null, role: string, overrides: object = {}) => ({ status: "active", name, email, role, project_access_mode: "ALL_PROJECTS", ...overrides });
  const run = async (role: string, members: unknown[] | Error, options: { json?: boolean } = {}) => {
    const context = setup([version(2)], options);
    const { get } = (context.ctx as unknown as { api: { get: (path: string) => Promise<unknown> } }).api;
    (context.ctx as unknown as { api: { get: unknown } }).api.get = async (path: string) => {
      if (path === "/v2/me/organizations") return { data: [{ id: 7, role }] };
      if (path === "/v2/me") return { email: "me@example.com" };
      if (path === "/v2/organizations/7/access/members") {
        if (members instanceof Error) throw members;
        return { data: members };
      }
      return get(path);
    };
    await runArtifactShare(context.ctx, { artifact: "42" });
    return context;
  };

  const asked = await run("USER", [
    member("Alex Owner", "alex@example.com", "OWNER"),
    member(null, "sam@example.com", "ADMIN"),
    member("Restricted Admin", "r@example.com", "ADMIN", { project_access_mode: "RESTRICTED" }),
    member("Invited Owner", "i@example.com", "OWNER", { status: "pending" }),
    member("Another User", "u@example.com", "USER"),
    member(null, null, "ADMIN"),
  ]);
  assert.match(asked.said("info").join(), /Nobody is told automatically\. Ask one of the people who can approve it: Alex Owner, sam@example\.com\./);

  const many = await run("EDITOR", ["A", "B", "C", "D", "E", "F", "G"].map((name) => member(name, null, "ADMIN")));
  assert.match(many.said("info").join(), /A, B, C, D, E or 2 more\./);

  const unknowable = await run("USER", new ApiError("GET members", 403, "{}"));
  assert.match(unknowable.said("info").join(), /Ask an organization owner or admin to approve it\./);

  const admin = await run("OWNER", [member("Alex Owner", null, "OWNER")]);
  assert.doesNotMatch(admin.said("info").join(), /Nobody is told/);

  const restricted = await run("ADMIN", [
    member("Me", "me@example.com", "ADMIN", { project_access_mode: "RESTRICTED" }),
    member("Alex Owner", "alex@example.com", "OWNER"),
  ]);
  assert.match(restricted.said("info").join(), /Nobody is told automatically\. Ask one of the people who can approve it: Alex Owner\./, "a restricted admin can't approve");

  const allProjects = await run("ADMIN", [member("Me", "me@example.com", "ADMIN")]);
  assert.doesNotMatch(allProjects.said("info").join(), /Nobody is told/);

  const noList = await run("ADMIN", new ApiError("GET members", 403, "{}"));
  assert.doesNotMatch(noList.said("info").join(), /Nobody is told/, "with no list, the role is all there is to go on");

  const json = await run("USER", [member("Alex Owner", null, "OWNER")], { json: true });
  assert.deepEqual((json.data[0] as { approvers: string[]; can_approve: boolean }).approvers, ["Alex Owner"]);
  assert.equal((json.data[0] as { can_approve: boolean }).can_approve, false);
});

test("share tells a staff account nobody can see it", async () => {
  const context = setup([version(2)], { artifact: artifact({ author_version_id: null }) });
  const { get } = (context.ctx as unknown as { api: { get: (path: string) => Promise<unknown> } }).api;
  (context.ctx as unknown as { api: { get: unknown } }).api.get = async (path: string) =>
    path === "/v2/me" ? { role: "SUPERADMIN", email: "staff@example.com" } : get(path);
  await runArtifactShare(context.ctx, { artifact: "42" });
  assert.match(context.said("success").join(), /marked for review\. Nobody can see version 2 until an admin approves it/);
  assert.doesNotMatch(context.said("success").join(), /Only you/);
});

test("share won't ask about what's live, or when nothing's built", async () => {
  const live = setup([version(1)]);
  await assert.rejects(runArtifactShare(live.ctx, { artifact: "42" }), /already live/);
  assert.deepEqual(live.posts, []);
  const none = setup([version(2, { build_status: "FAILED" })]);
  await assert.rejects(runArtifactShare(none.ctx, { artifact: "42" }), /no version for this yet/);
});
