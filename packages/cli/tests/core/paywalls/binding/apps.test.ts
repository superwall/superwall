import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import type { SuperwallApi } from "@/core/api/client";
import {
  AppBindingError,
  describePlatforms,
  platformFor,
  platformOf,
  requirePlatform,
  resolveApps,
} from "@/core/paywalls/binding/apps";
import { readLock, writeApp } from "@/core/paywalls/project/lock";

function fakeApi(projects: unknown[], calls: string[] = []): SuperwallApi {
  const fake = {
    org: { id: undefined, name: undefined, count: 1 },
    list: async (apiPath: string) => {
      calls.push(`list ${apiPath}`);
      if (apiPath === "/v2/projects") return projects;
      throw new Error(`unexpected list ${apiPath}`);
    },
    get: async (apiPath: string) => {
      throw new Error(`unexpected get ${apiPath}`);
    },
    post: async (apiPath: string) => {
      throw new Error(`unexpected post ${apiPath}`);
    },
  };
  return fake as unknown as SuperwallApi;
}

const dirs: string[] = [];

function scaffold(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-apps-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

const THREE = [
  {
    id: 9,
    applications: [
      { id: 1, name: "Puzzler", platform: "ios" },
      { id: 2, name: "Puzzler Android", platform: "android" },
      { id: 3, name: "puzzler.com", platform: "web" },
    ],
  },
];

test("platformOf is ios, android, or web as the API reports it — nothing else", () => {
  assert.equal(platformOf({ id: 1, platform: "iOS" }), "ios");
  assert.equal(platformOf({ id: 1, platform: "Android" }), "android");
  assert.equal(platformOf({ id: 1, platform: "web" }), "web");
  assert.equal(platformOf({ id: 1, platform: "flutter" }), undefined);
  assert.equal(platformOf({ id: 1 }), undefined);
});

test("an app whose platform is not ios, android, or web is never guessed at — it is refused by name", async () => {
  const dir = scaffold();
  const api = fakeApi([{ id: 9, applications: [{ id: 7, name: "Flutter thing", platform: "flutter" }] }]);
  await assert.rejects(
    resolveApps({ api, superwallDir: dir }),
    (error: Error) =>
      error instanceof AppBindingError &&
      /`Flutter thing` is a Flutter app/.test(error.message) &&
      /ios, android, web apps only/.test(error.message),
  );
  assert.deepEqual(readLock(dir).apps, {});
  assert.throws(() => requirePlatform({ id: 1 }), AppBindingError);
  assert.equal(requirePlatform({ id: 1, platform: "web" }), "web");
});

test("platformFor accepts a platform or the app id bound to it", () => {
  const apps = { ios: "1", web: "3" };
  assert.equal(platformFor(apps, "ios"), "ios");
  assert.equal(platformFor(apps, "3"), "web");
  assert.equal(platformFor(apps, "android"), undefined);
  assert.equal(describePlatforms(apps), "ios, web");
});

test("a lock that already binds every wanted platform never touches the API", async () => {
  const dir = scaffold();
  writeApp(dir, "ios", "1");
  writeApp(dir, "android", "2");
  const calls: string[] = [];

  const apps = await resolveApps({ api: fakeApi([], calls), superwallDir: dir, wanted: ["android", "ios"] });

  assert.deepEqual(apps, { ios: "1", android: "2" });
  assert.deepEqual(calls, []);
});

test("a wanted platform binds itself when exactly one unbound app has it", async () => {
  const dir = scaffold();
  writeApp(dir, "ios", "1");
  const calls: string[] = [];

  const apps = await resolveApps({
    api: fakeApi(THREE, calls),
    superwallDir: dir,
    wanted: ["ios", "android", "web"],
  });

  assert.deepEqual(apps, { ios: "1", android: "2", web: "3" });
  assert.deepEqual(calls, ["list /v2/projects"], "the app list is fetched once");
});

test("two apps of the same platform ask the picker, offering only those", async () => {
  const dir = scaffold();
  const twoIos = [
    { id: 9, applications: [{ id: 1, platform: "ios" }, { id: 4, platform: "ios" }, { id: 5, platform: "web" }] },
  ];
  let offered: string[] = [];

  const apps = await resolveApps({
    api: fakeApi(twoIos),
    superwallDir: dir,
    wanted: ["ios"],
    pickApplication: async (candidates, platform) => {
      assert.equal(platform, "ios");
      offered = candidates.map((app) => String(app.id));
      return candidates.find((app) => String(app.id) === "4") ?? null;
    },
  });

  assert.deepEqual(offered, ["1", "4"]);
  assert.deepEqual(apps, { ios: "4" });
});

test("two apps of the same platform are never guessed between without a picker", async () => {
  const dir = scaffold();
  const twoIos = [{ id: 9, applications: [{ id: 1, platform: "ios" }, { id: 4, platform: "ios" }] }];

  await assert.rejects(
    resolveApps({ api: fakeApi(twoIos), superwallDir: dir, wanted: ["ios"] }),
    (error: Error) =>
      error instanceof AppBindingError &&
      /Several iOS apps/.test(error.message) &&
      /"ios": "<app id>"/.test(error.message),
  );
  assert.deepEqual(readLock(dir).apps, {});
});

test("a declined picker fails without writing", async () => {
  const dir = scaffold();
  const twoIos = [{ id: 9, applications: [{ id: 1, platform: "ios" }, { id: 4, platform: "ios" }] }];
  await assert.rejects(
    resolveApps({
      api: fakeApi(twoIos),
      superwallDir: dir,
      wanted: ["ios"],
      pickApplication: async () => null,
    }),
    AppBindingError,
  );
  assert.deepEqual(readLock(dir).apps, {});
});

test("a platform with no app in the account says to create one", async () => {
  const dir = scaffold();
  writeApp(dir, "ios", "1");
  const iosOnly = [{ id: 9, applications: [{ id: 1, platform: "ios" }] }];

  await assert.rejects(
    resolveApps({ api: fakeApi(iosOnly), superwallDir: dir, wanted: ["android"] }),
    (error: Error) =>
      error instanceof AppBindingError &&
      /no Android app to bind/.test(error.message) &&
      /apps create --platform android/.test(error.message),
  );
});

test("an app already bound to another platform is not offered again", async () => {
  const dir = scaffold();
  writeApp(dir, "web", "1");

  await assert.rejects(
    resolveApps({ api: fakeApi([{ id: 9, applications: [{ id: 1, platform: "ios" }] }]), superwallDir: dir, wanted: ["ios"] }),
    (error: Error) => error instanceof AppBindingError && /no iOS app to bind/.test(error.message),
  );
});

test("a value that is not a platform is rejected before any lookup", async () => {
  const calls: string[] = [];
  await assert.rejects(
    resolveApps({ api: fakeApi([], calls), superwallDir: scaffold(), wanted: ["tv"] }),
    (error: Error) =>
      error instanceof AppBindingError &&
      /"tv" is not a platform/.test(error.message) &&
      /ios, android, web\./.test(error.message),
  );
  assert.deepEqual(calls, []);
});

test("with nothing wanted and nothing bound, a single app in the account binds itself under its platform", async () => {
  const dir = scaffold();
  const api = fakeApi([{ id: 9, applications: [{ id: 7, platform: "ios" }] }]);

  assert.deepEqual(await resolveApps({ api, superwallDir: dir }), { ios: "7" });
  assert.deepEqual(readLock(dir).apps, { ios: "7" });
});

test("several apps in the account need the picker once, and the pick is keyed by its platform", async () => {
  const dir = scaffold();
  const api = fakeApi(THREE);

  await assert.rejects(
    resolveApps({ api, superwallDir: dir }),
    (error: Error) => error instanceof AppBindingError && /Several apps in your account/.test(error.message),
  );

  const apps = await resolveApps({
    api,
    superwallDir: dir,
    pickApplication: async (candidates, platform) => {
      assert.equal(platform, undefined);
      return candidates.find((app) => String(app.id) === "2") ?? null;
    },
  });
  assert.deepEqual(apps, { android: "2" });
});

test("a declined first pick leaves the lock empty", async () => {
  const dir = scaffold();
  await assert.rejects(
    resolveApps({ api: fakeApi(THREE), superwallDir: dir, pickApplication: async () => null }),
    AppBindingError,
  );
  assert.deepEqual(readLock(dir).apps, {});
});

test("an account with no apps at all says how to make one", async () => {
  await assert.rejects(
    resolveApps({ api: fakeApi([]), superwallDir: scaffold() }),
    (error: Error) => error instanceof AppBindingError && /has no apps yet/.test(error.message),
  );
});
