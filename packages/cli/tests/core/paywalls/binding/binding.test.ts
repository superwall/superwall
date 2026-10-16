import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import type { SuperwallApi } from "@/core/api/client";
import { BindingError, resolveBinding } from "@/core/paywalls/binding/binding";
import type { FrameworkSurface } from "@/core/paywalls/project/framework";
import { readLock, writeApp, writeBinding } from "@/core/paywalls/project/lock";

const surface: FrameworkSurface = {
  kind: "paywall",
  id: "plus-upgrade",
  dir: "/tmp/x",
  configFile: "/tmp/x/config.ts",
  routes: [],
};

const ios = { platform: "ios", applicationId: "7" };
const android = { platform: "android", applicationId: "8" };

interface FakeRoutes {
  paywalls?: Record<string, unknown[]>;
  archivedPaywalls?: Record<string, unknown[]>;
  created?: Record<string, unknown>;
}

const posted: Record<string, unknown>[] = [];

const yes = async () => true;

function fakeApi(routes: FakeRoutes, calls: string[] = []): SuperwallApi {
  const fake = {
    org: { id: undefined, name: undefined, count: 1 },
    list: async (apiPath: string) => {
      calls.push(`list ${apiPath}`);
      const match = /application_id=(\d+)/.exec(apiPath);
      const app = match?.[1] ?? "";
      if (apiPath.startsWith("/v2/paywalls")) {
        return apiPath.includes("archived=true")
          ? (routes.archivedPaywalls?.[app] ?? [])
          : (routes.paywalls?.[app] ?? []);
      }
      throw new Error(`unexpected list ${apiPath}`);
    },
    get: async (apiPath: string) => {
      calls.push(`get ${apiPath}`);
      throw new Error(`unexpected get ${apiPath}`);
    },
    post: async (apiPath: string, body?: unknown) => {
      calls.push(`post ${apiPath}`);
      posted.push(Object(body) as Record<string, unknown>);
      if (apiPath === "/v2/paywalls") return routes.created ?? { id: 9 };
      throw new Error(`unexpected post ${apiPath}`);
    },
  };
  return fake as unknown as SuperwallApi;
}

const dirs: string[] = [];

function scaffold(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-binding-"));
  dirs.push(dir);
  writeApp(dir, "ios", "7");
  return dir;
}

afterEach(() => {
  posted.length = 0;
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the lock wins before touching the API", async () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "208540" });
  const calls: string[] = [];

  const resolved = await resolveBinding({
    api: fakeApi({}, calls),
    superwallDir: dir,
    surface,
    app: ios,
    surfaces: [surface],
  });
  assert.deepEqual(resolved, {
    paywallId: "208540",
    applicationId: "7",
    platform: "ios",
    source: "lock",
  });
  assert.deepEqual(calls, []);
});

test("a binding for one app never answers for another", async () => {
  const dir = scaffold();
  writeApp(dir, "android", "8");
  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "208540" });
  const api = fakeApi({ paywalls: { "8": [] }, created: { id: 300 } });

  const resolved = await resolveBinding({
    api,
    superwallDir: dir,
    surface,
    app: android,
    surfaces: [surface],
  });

  assert.deepEqual(resolved, {
    paywallId: "300",
    applicationId: "8",
    platform: "android",
    source: "created",
  });
  assert.deepEqual(readLock(dir).paywalls["plus-upgrade"], {
    ios: { paywallId: "208540" },
    android: { paywallId: "300" },
  });
});

test("an existing headless paywall is adopted and locked once confirmed", async () => {
  const dir = scaffold();
  const api = fakeApi({
    paywalls: { "7": [{ id: 208540, identifier: "plus-upgrade", metadata: { headless: "true" } }] },
  });

  const resolved = await resolveBinding({
    api,
    superwallDir: dir,
    surface,
    app: ios,
    surfaces: [surface],
    confirmAdopt: yes,
  });

  assert.deepEqual(resolved, {
    paywallId: "208540",
    applicationId: "7",
    platform: "ios",
    source: "matched",
  });
  assert.deepEqual(readLock(dir).paywalls["plus-upgrade"], { ios: { paywallId: "208540" } });
});

test("the match is looked up on the target app, not on whichever app is first", async () => {
  const dir = scaffold();
  const api = fakeApi({
    paywalls: {
      "7": [{ id: 1, identifier: "plus-upgrade", metadata: { headless: "true" } }],
      "8": [{ id: 2, identifier: "plus-upgrade", metadata: { headless: "true" } }],
    },
  });

  const resolved = await resolveBinding({
    api,
    superwallDir: dir,
    surface,
    app: android,
    surfaces: [surface],
    confirmAdopt: yes,
  });
  assert.equal(resolved.paywallId, "2");
});

test("metadata.headlessSurface outranks an identifier match", async () => {
  const dir = scaffold();
  const api = fakeApi({
    paywalls: {
      "7": [
        {
          id: 1,
          identifier: "other",
          metadata: { headless: "true", headlessSurface: "plus-upgrade" },
        },
        { id: 2, identifier: "plus-upgrade", metadata: { headless: "true" } },
      ],
    },
  });

  const resolved = await resolveBinding({
    api,
    superwallDir: dir,
    surface,
    app: ios,
    surfaces: [surface],
    confirmAdopt: yes,
  });
  assert.equal(resolved.paywallId, "1");
  assert.equal(resolved.source, "matched");
});

test("creates the paywall when nothing matches and locks the result", async () => {
  const dir = scaffold();
  const api = fakeApi({ created: { id: 9 } });

  const resolved = await resolveBinding({
    api,
    superwallDir: dir,
    surface,
    app: ios,
    surfaces: [surface],
  });

  assert.deepEqual(resolved, {
    paywallId: "9",
    applicationId: "7",
    platform: "ios",
    source: "created",
  });
  assert.deepEqual(readLock(dir).paywalls["plus-upgrade"], { ios: { paywallId: "9" } });
  assert.equal(posted[0]?.application_id, "7");
});

test("create:false refuses to invent a paywall for an unpushed surface, naming the app", async () => {
  const dir = scaffold();
  const calls: string[] = [];
  const api = fakeApi({}, calls);

  await assert.rejects(
    resolveBinding({
      api,
      superwallDir: dir,
      surface,
      app: ios,
      surfaces: [surface],
      create: false,
    }),
    (error: Error) =>
      error instanceof BindingError && /never been pushed to `ios`/.test(error.message),
  );

  assert.equal(
    calls.some((call) => call.startsWith("post")),
    false,
  );
  assert.deepEqual(readLock(dir).paywalls, {});
});

test("create:false still resolves an already-bound surface", async () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "208540" });

  const resolved = await resolveBinding({
    api: fakeApi({}),
    superwallDir: dir,
    surface,
    app: ios,
    surfaces: [surface],
    create: false,
  });
  assert.equal(resolved.source, "lock");
});

test("an archived paywall owning the identifier is explained, not 409'd", async () => {
  const dir = scaffold();
  const calls: string[] = [];
  const api = fakeApi(
    {
      archivedPaywalls: {
        "7": [{ id: 500, identifier: "plus-upgrade", metadata: { headless: "true" } }],
      },
    },
    calls,
  );

  await assert.rejects(
    resolveBinding({ api, superwallDir: dir, surface, app: ios, surfaces: [surface] }),
    (error: Error) =>
      error instanceof BindingError &&
      /archived paywall 500 on `ios`/.test(error.message) &&
      /Restore it/.test(error.message),
  );
  assert.equal(
    calls.some((call) => call.startsWith("post")),
    false,
  );
});

test("an unbound newcomer beside an orphaned binding refuses to create until renames are resolved", async () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "old-name", "ios", { paywallId: "1" });
  const api = fakeApi({ created: { id: 9 } });

  await assert.rejects(
    resolveBinding({ api, superwallDir: dir, surface, app: ios, surfaces: [surface] }),
    (error: Error) => error instanceof BindingError && /still binds old-name/.test(error.message),
  );

  const resolved = await resolveBinding({
    api,
    superwallDir: dir,
    surface,
    app: ios,
    surfaces: [surface],
    renamesResolved: true,
  });
  assert.equal(resolved.source, "created");
});

test("a funnel binds in its own section, never the paywall one", async () => {
  const dir = scaffold();
  const funnel: FrameworkSurface = { ...surface, kind: "funnel", id: "onboarding" };
  const api = fakeApi({ created: { id: 77 } });

  const resolved = await resolveBinding({
    api,
    superwallDir: dir,
    surface: funnel,
    app: ios,
    surfaces: [funnel],
  });

  assert.equal(resolved.paywallId, "77");
  assert.deepEqual(readLock(dir).funnels.onboarding, { ios: { paywallId: "77" } });
  assert.deepEqual(readLock(dir).paywalls, {});
});

test("a non-headless paywall sharing the identifier is ignored, not hijacked", async () => {
  const dir = scaffold();
  const api = fakeApi({
    paywalls: { "7": [{ id: 1, identifier: "plus-upgrade", metadata: {} }] },
    created: { id: 2 },
  });

  const resolved = await resolveBinding({
    api,
    superwallDir: dir,
    surface,
    app: ios,
    surfaces: [surface],
  });
  assert.equal(resolved.source, "created");
  assert.equal(resolved.paywallId, "2");
});

test("a created paywall carries the name the config gave it, or the title-cased directory", async () => {
  const dir = scaffold();
  const api = fakeApi({ created: { id: 9 } });

  await resolveBinding({
    api,
    superwallDir: dir,
    surface,
    app: ios,
    name: "Winback — Annual, 3-day trial",
    surfaces: [surface],
  });
  assert.equal(posted[0]?.name, "Winback — Annual, 3-day trial");
  assert.equal(posted[0]?.identifier, "plus-upgrade");

  await resolveBinding({
    api,
    superwallDir: dir,
    surface,
    app: android,
    name: "   ",
    surfaces: [surface],
  });
  assert.equal(posted[1]?.name, "Plus Upgrade");
});

test("an unbound match is never adopted without a confirmation", async () => {
  const dir = scaffold();
  const calls: string[] = [];
  const api = fakeApi(
    {
      paywalls: {
        "7": [{ id: 274523, identifier: "plus-upgrade", metadata: { headless: "true" } }],
      },
    },
    calls,
  );

  await assert.rejects(
    resolveBinding({ api, superwallDir: dir, surface, app: ios, surfaces: [surface] }),
    (error: unknown) =>
      error instanceof BindingError &&
      /App 7 already has a paywall `plus-upgrade` \(274523\)/.test(error.message) &&
      /"plus-upgrade": \{ "ios": \{ "paywallId": "274523" \} \}/.test(error.message),
  );
  assert.deepEqual(readLock(dir).paywalls, {});
  assert.ok(!calls.some((call) => call.startsWith("post")));
});

test("a declined adoption binds nothing and creates nothing", async () => {
  const dir = scaffold();
  const calls: string[] = [];
  const seen: unknown[] = [];
  const api = fakeApi(
    {
      paywalls: {
        "7": [{ id: 274523, identifier: "plus-upgrade", metadata: { headless: "true" } }],
      },
    },
    calls,
  );

  await assert.rejects(
    resolveBinding({
      api,
      superwallDir: dir,
      surface,
      app: ios,
      surfaces: [surface],
      confirmAdopt: async (candidate) => {
        seen.push(candidate);
        return false;
      },
    }),
    BindingError,
  );
  assert.deepEqual(seen, [{ surface, paywallId: "274523", applicationId: "7", platform: "ios" }]);
  assert.deepEqual(readLock(dir).paywalls, {});
  assert.ok(!calls.some((call) => call.startsWith("post")));
});

test("promote never adopts an unbound match without a confirmation either", async () => {
  const dir = scaffold();
  const api = fakeApi({
    paywalls: { "7": [{ id: 274523, identifier: "plus-upgrade", metadata: { headless: "true" } }] },
  });

  await assert.rejects(
    resolveBinding({
      api,
      superwallDir: dir,
      surface,
      app: ios,
      surfaces: [surface],
      create: false,
    }),
    BindingError,
  );
  assert.deepEqual(readLock(dir).paywalls, {});
});
