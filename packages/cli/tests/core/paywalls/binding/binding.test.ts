import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import type { SuperwallApi } from "@/core/api/client";
import { BindingError, resolveBinding } from "@/core/paywalls/binding/binding";
import type { FrameworkSurface } from "@/core/paywalls/project/framework";
import { readLock, writeApplicationId, writeBinding } from "@/core/paywalls/project/lock";

const surface: FrameworkSurface = {
  kind: "paywall",
  id: "plus-upgrade",
  dir: "/tmp/x",
  configFile: "/tmp/x/config.ts",
  pages: [],
};

interface FakeRoutes {
  paywall?: unknown;
  projects?: unknown[];
  paywalls?: unknown[];
  archivedPaywalls?: unknown[];
  created?: Record<string, unknown>;
  orgId?: string;
}

function fakeApi(routes: FakeRoutes, calls: string[] = []): SuperwallApi {
  const fake = {
    org: { id: routes.orgId, name: undefined, count: 1 },
    list: async (apiPath: string) => {
      calls.push(`list ${apiPath}`);
      if (apiPath === "/v2/projects") return routes.projects ?? [];
      if (apiPath.startsWith("/v2/paywalls")) {
        return apiPath.includes("archived=true")
          ? (routes.archivedPaywalls ?? [])
          : (routes.paywalls ?? []);
      }
      throw new Error(`unexpected list ${apiPath}`);
    },
    get: async (apiPath: string) => {
      calls.push(`get ${apiPath}`);
      if (/^\/v2\/paywalls\/\d+$/.test(apiPath)) return routes.paywall ?? {};
      throw new Error(`unexpected get ${apiPath}`);
    },
    post: async (apiPath: string) => {
      calls.push(`post ${apiPath}`);
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
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the lock wins before touching the API", async () => {
  const dir = scaffold();
  writeApplicationId(dir, "7");
  writeBinding(dir, "paywall", "plus-upgrade", { paywallId: "208540" });
  const calls: string[] = [];

  const resolved = await resolveBinding({
    api: fakeApi({}, calls),
    superwallDir: dir,
    surface,
    surfaces: [surface],
  });
  assert.deepEqual(resolved, { paywallId: "208540", applicationId: "7", source: "lock" });
  assert.deepEqual(calls, []);
});

test("a lock without an app id learns it from the paywall and writes it back", async () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "plus-upgrade", { paywallId: "208540" });
  const calls: string[] = [];

  const resolved = await resolveBinding({
    api: fakeApi({ paywall: { id: 208540, application_id: 7 } }, calls),
    superwallDir: dir,
    surface,
    surfaces: [surface],
  });

  assert.deepEqual(resolved, { paywallId: "208540", applicationId: "7", source: "lock" });
  assert.deepEqual(calls, ["get /v2/paywalls/208540"]);
  assert.equal(readLock(dir).applicationId, "7");
});

test("a single app in the account binds itself and is cached in the lock", async () => {
  const dir = scaffold();
  const api = fakeApi({
    projects: [{ applications: [{ id: 7, name: "Puzzler" }] }],
    paywalls: [{ id: 208540, identifier: "plus-upgrade", metadata: { headless: "true" } }],
  });

  const resolved = await resolveBinding({
    api,
    superwallDir: dir,
    surface,
    surfaces: [surface],
  });

  assert.deepEqual(resolved, { paywallId: "208540", applicationId: "7", source: "matched" });
  const lock = readLock(dir);
  assert.equal(lock.applicationId, "7");
  assert.deepEqual(lock.paywalls["plus-upgrade"], { paywallId: "208540" });
});

test("metadata.headlessSurface outranks an identifier match", async () => {
  const dir = scaffold();
  writeApplicationId(dir, "7");
  const api = fakeApi({
    paywalls: [
      {
        id: 1,
        identifier: "other",
        metadata: { headless: "true", headlessSurface: "plus-upgrade" },
      },
      { id: 2, identifier: "plus-upgrade", metadata: { headless: "true" } },
    ],
  });

  const resolved = await resolveBinding({
    api,
    superwallDir: dir,
    surface,
    surfaces: [surface],
  });
  assert.deepEqual(resolved, { paywallId: "1", applicationId: "7", source: "matched" });
});

test("creates the paywall when nothing matches and locks the result", async () => {
  const dir = scaffold();
  writeApplicationId(dir, "7");
  const api = fakeApi({ paywalls: [], created: { id: 9 } });

  const resolved = await resolveBinding({
    api,
    superwallDir: dir,
    surface,
    surfaces: [surface],
  });

  assert.deepEqual(resolved, { paywallId: "9", applicationId: "7", source: "created" });
  assert.deepEqual(readLock(dir).paywalls["plus-upgrade"], { paywallId: "9" });
});

test("several apps without a picker fails with guidance", async () => {
  const api = fakeApi({
    projects: [{ applications: [{ id: 1 }, { id: 2 }] }],
  });

  await assert.rejects(
    resolveBinding({
      api,
      superwallDir: scaffold(),
      surfaces: [surface],
      surface,
    }),
    BindingError,
  );
});

test("several apps with a picker binds the chosen app", async () => {
  const dir = scaffold();
  const api = fakeApi({
    projects: [{ applications: [{ id: 1, name: "A" }, { id: 2, name: "B" }] }],
    paywalls: [],
    created: { id: 42 },
  });

  const resolved = await resolveBinding({
    api,
    superwallDir: dir,
    surface,
    surfaces: [surface],
    pickApplication: async (apps) => apps.find((app) => String(app.id) === "2") ?? null,
  });

  assert.deepEqual(resolved, { paywallId: "42", applicationId: "2", source: "created" });
  assert.equal(readLock(dir).applicationId, "2");
});

test("create:false refuses to invent a paywall for an unpushed surface", async () => {
  const dir = scaffold();
  writeApplicationId(dir, "7");
  const calls: string[] = [];
  const api = fakeApi({ paywalls: [] }, calls);

  await assert.rejects(
    resolveBinding({
      api,
      superwallDir: dir,
      surface,
      surfaces: [surface],
      create: false,
    }),
    (error: Error) => error instanceof BindingError && /never been pushed/.test(error.message),
  );

  assert.equal(
    calls.some((call) => call.startsWith("post")),
    false,
  );
  assert.deepEqual(readLock(dir).paywalls, {});
});

test("create:false still resolves an already-bound surface", async () => {
  const dir = scaffold();
  writeApplicationId(dir, "7");
  writeBinding(dir, "paywall", "plus-upgrade", { paywallId: "208540" });

  const resolved = await resolveBinding({
    api: fakeApi({}),
    superwallDir: dir,
    surface,
    surfaces: [surface],
    create: false,
  });
  assert.deepEqual(resolved, { paywallId: "208540", applicationId: "7", source: "lock" });
});

test("an archived paywall owning the identifier is explained, not 409'd", async () => {
  const dir = scaffold();
  writeApplicationId(dir, "7");
  const calls: string[] = [];
  const api = fakeApi(
    {
      paywalls: [],
      archivedPaywalls: [
        { id: 500, identifier: "plus-upgrade", metadata: { headless: "true" } },
      ],
    },
    calls,
  );

  await assert.rejects(
    resolveBinding({
      api,
      superwallDir: dir,
      surface,
      surfaces: [surface],
    }),
    (error: Error) =>
      error instanceof BindingError &&
      /archived paywall 500/.test(error.message) &&
      /Restore it/.test(error.message),
  );

  assert.equal(
    calls.some((call) => call.startsWith("post")),
    false,
  );
});

test("an account with no apps at all says how to make one", async () => {
  const dir = scaffold();
  const api = fakeApi({ projects: [] });

  await assert.rejects(
    resolveBinding({ api, superwallDir: dir, surface, surfaces: [surface] }),
    (error: Error) => error instanceof BindingError && /has no apps yet/.test(error.message),
  );
});

test("declining the app picker leaves the lock untouched and explains the choice", async () => {
  const dir = scaffold();
  const api = fakeApi({
    projects: [{ applications: [{ id: 1, name: "A" }, { id: 2, name: "B" }] }],
  });

  await assert.rejects(
    resolveBinding({
      api,
      superwallDir: dir,
      surface,
      surfaces: [surface],
      pickApplication: async () => null,
    }),
    (error: Error) => error instanceof BindingError && /Several apps in your account/.test(error.message),
  );
  assert.equal(readLock(dir).applicationId, undefined);
});

test("a funnel binds in its own section, never the paywall one", async () => {
  const dir = scaffold();
  writeApplicationId(dir, "7");
  const funnel: FrameworkSurface = {
    kind: "funnel",
    id: "onboarding",
    dir: "/tmp/x",
    configFile: "/tmp/x/config.ts",
    pages: [],
  };
  const api = fakeApi({ paywalls: [], created: { id: 77 } });

  const resolved = await resolveBinding({
    api,
    superwallDir: dir,
    surface: funnel,
    surfaces: [funnel],
  });

  assert.deepEqual(resolved, { paywallId: "77", applicationId: "7", source: "created" });
  assert.deepEqual(readLock(dir).funnels["onboarding"], { paywallId: "77" });
  assert.deepEqual(readLock(dir).paywalls, {});
});

test("a non-headless paywall sharing the identifier is ignored, not hijacked", async () => {
  const dir = scaffold();
  writeApplicationId(dir, "7");
  const api = fakeApi({
    paywalls: [{ id: 1, identifier: "plus-upgrade", metadata: {} }],
    created: { id: 2 },
  });

  const resolved = await resolveBinding({ api, superwallDir: dir, surface, surfaces: [surface] });
  assert.equal(resolved.source, "created");
  assert.equal(resolved.paywallId, "2");
});
