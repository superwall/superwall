import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import type { SuperwallApi } from "@/core/api/client";
import { BindingError, resolveBinding } from "@/core/paywalls/binding";
import type { FrameworkSurface } from "@/core/paywalls/framework";
import { readLock, writeApplicationId, writeBinding } from "@/core/paywalls/lock";

const surface: FrameworkSurface = {
  kind: "paywall",
  id: "plus-upgrade",
  dir: "/tmp/x",
  pages: [],
};

interface FakeRoutes {
  projects?: unknown[];
  paywalls?: unknown[];
  archivedPaywalls?: unknown[];
  created?: Record<string, unknown>;
  orgId?: string;
}

/** Structural SuperwallApi fake — only the routes binding actually calls. */
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
  writeBinding(dir, "paywall", "plus-upgrade", { paywallId: "208540" });
  const calls: string[] = [];

  const resolved = await resolveBinding({
    api: fakeApi({}, calls),
    superwallDir: dir,
    surface,
  });
  assert.deepEqual(resolved, { paywallId: "208540", source: "lock" });
  assert.deepEqual(calls, []);
});

test("a single app in the account binds itself and is cached in the lock", async () => {
  const dir = scaffold();
  const api = fakeApi({
    projects: [{ applications: [{ id: 7, name: "Puzzler" }] }],
    paywalls: [{ id: 208540, identifier: "plus-upgrade", metadata: {} }],
  });

  const resolved = await resolveBinding({
    api,
    superwallDir: dir,
    surface,
  });

  assert.deepEqual(resolved, { paywallId: "208540", source: "matched" });
  const lock = readLock(dir);
  assert.equal(lock.applicationId, "7");
  assert.deepEqual(lock.paywalls["plus-upgrade"], { paywallId: "208540" });
});

test("metadata.headlessSurface outranks an identifier match", async () => {
  const dir = scaffold();
  writeApplicationId(dir, "7");
  const api = fakeApi({
    paywalls: [
      { id: 1, identifier: "other", metadata: { headlessSurface: "plus-upgrade" } },
      { id: 2, identifier: "plus-upgrade", metadata: {} },
    ],
  });

  const resolved = await resolveBinding({
    api,
    superwallDir: dir,
    surface,
  });
  assert.deepEqual(resolved, { paywallId: "1", source: "matched" });
});

test("creates the paywall when nothing matches and locks the result", async () => {
  const dir = scaffold();
  writeApplicationId(dir, "7");
  const api = fakeApi({ paywalls: [], created: { id: 9 } });

  const resolved = await resolveBinding({
    api,
    superwallDir: dir,
    surface,
  });

  assert.deepEqual(resolved, { paywallId: "9", source: "created" });
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
    pickApplication: async (apps) => apps.find((app) => String(app.id) === "2") ?? null,
  });

  assert.deepEqual(resolved, { paywallId: "42", source: "created" });
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
      create: false,
    }),
    (error: Error) => error instanceof BindingError && /never been pushed/.test(error.message),
  );

  // Nothing created, nothing written to the lock.
  assert.equal(
    calls.some((call) => call.startsWith("post")),
    false,
  );
  assert.deepEqual(readLock(dir).paywalls, {});
});

test("create:false still resolves an already-bound surface", async () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "plus-upgrade", { paywallId: "208540" });

  const resolved = await resolveBinding({
    api: fakeApi({}),
    superwallDir: dir,
    surface,
    create: false,
  });
  assert.deepEqual(resolved, { paywallId: "208540", source: "lock" });
});

test("an archived paywall owning the identifier is explained, not 409'd", async () => {
  const dir = scaffold();
  writeApplicationId(dir, "7");
  const calls: string[] = [];
  const api = fakeApi(
    { paywalls: [], archivedPaywalls: [{ id: 500, identifier: "plus-upgrade", metadata: {} }] },
    calls,
  );

  await assert.rejects(
    resolveBinding({
      api,
      superwallDir: dir,
      surface,
    }),
    (error: Error) =>
      error instanceof BindingError &&
      /archived paywall 500/.test(error.message) &&
      /Restore it/.test(error.message),
  );

  // Never attempts the create that would fail with a raw 409.
  assert.equal(
    calls.some((call) => call.startsWith("post")),
    false,
  );
});
