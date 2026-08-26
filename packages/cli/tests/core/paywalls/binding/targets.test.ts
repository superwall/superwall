import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parsePlatformFlags,
  planTargets,
  surfaceKey,
  TargetError,
  targetLabel,
  wantedPlatforms,
} from "@/core/paywalls/binding/targets";
import type { FrameworkSurface } from "@/core/paywalls/project/framework";

const surfaceOf = (id: string, kind: "paywall" | "funnel" = "paywall"): FrameworkSurface => ({
  kind,
  id,
  dir: `/tmp/${id}`,
  configFile: `/tmp/${id}/config.ts`,
  routes: [],
});

const shared = surfaceOf("plus-upgrade");
const webOnly = surfaceOf("web-upgrade");
const silent = surfaceOf("quiet");
const apps = { ios: "1", android: "2", web: "3" };
const declared = {
  "paywall/plus-upgrade": ["ios", "android"],
  "paywall/web-upgrade": ["web"],
};

const pairs = (targets: ReturnType<typeof planTargets>) =>
  targets.map((target) => `${target.surface.id}@${target.platform}=${target.applicationId}`);

test("a surface fans out to one target per declared platform, in declared order", () => {
  const targets = planTargets({ surfaces: [shared, webOnly], declared, apps });
  assert.deepEqual(pairs(targets), [
    "plus-upgrade@ios=1",
    "plus-upgrade@android=2",
    "web-upgrade@web=3",
  ]);
});

test("--platform narrows to the named platforms, or to a bound app id", () => {
  assert.deepEqual(
    pairs(planTargets({ surfaces: [shared, webOnly], declared, apps, only: ["android"] })),
    ["plus-upgrade@android=2"],
  );
  assert.deepEqual(
    pairs(planTargets({ surfaces: [shared, webOnly], declared, apps, only: ["3", "ios"] })),
    ["plus-upgrade@ios=1", "web-upgrade@web=3"],
  );
});

test("an unknown --platform names the platforms the project has", () => {
  assert.throws(
    () => planTargets({ surfaces: [shared], declared, apps, only: ["tv"] }),
    (error: Error) =>
      error instanceof TargetError &&
      /no app for "tv"/.test(error.message) &&
      /ios, android, web/.test(error.message),
  );
});

test("--platform that no selected surface targets is an error, not a silent no-op", () => {
  assert.throws(
    () => planTargets({ surfaces: [webOnly], declared, apps, only: ["ios"] }),
    (error: Error) => error instanceof TargetError && /No paywall or funnel targets `ios`/.test(error.message),
  );
});

test("a surface that says nothing targets the only platform when there is one", () => {
  const targets = planTargets({ surfaces: [silent], declared: {}, apps: { ios: "1" } });
  assert.deepEqual(pairs(targets), ["quiet@ios=1"]);
});

test("a surface that says nothing is ambiguous once the project has several platforms", () => {
  assert.throws(
    () => planTargets({ surfaces: [silent], declared: {}, apps }),
    (error: Error) =>
      error instanceof TargetError &&
      /`quiet` doesn't say which platforms it's for/.test(error.message) &&
      /paywalls\/quiet\/config\.ts/.test(error.message),
  );
});

test("a surface that says nothing with no apps bound at all points at push", () => {
  assert.throws(
    () => planTargets({ surfaces: [silent], declared: {}, apps: {} }),
    (error: Error) => error instanceof TargetError && /not bound to an app yet/.test(error.message),
  );
});

test("an empty platforms list and a platform the lock does not bind are both refused", () => {
  assert.throws(
    () => planTargets({ surfaces: [silent], declared: { "paywall/quiet": [] }, apps }),
    (error: Error) => error instanceof TargetError && /`platforms: \[\]`/.test(error.message),
  );
  assert.throws(
    () => planTargets({ surfaces: [silent], declared: { "paywall/quiet": ["tv"] }, apps }),
    (error: Error) => error instanceof TargetError && /targets `tv`, which superwall\.lock does not bind/.test(error.message),
  );
});

test("duplicate platforms in a config collapse to one target", () => {
  const targets = planTargets({
    surfaces: [silent],
    declared: { "paywall/quiet": ["ios", "ios"] },
    apps,
  });
  assert.deepEqual(pairs(targets), ["quiet@ios=1"]);
});

test("funnels are keyed by kind so a paywall and a funnel may share an id", () => {
  const funnel = surfaceOf("plus-upgrade", "funnel");
  assert.equal(surfaceKey(funnel), "funnel/plus-upgrade");
  const targets = planTargets({
    surfaces: [shared, funnel],
    declared: { ...declared, "funnel/plus-upgrade": ["web"] },
    apps,
  });
  assert.deepEqual(pairs(targets), ["plus-upgrade@ios=1", "plus-upgrade@android=2", "plus-upgrade@web=3"]);
});

test("wantedPlatforms unions every declared platform across the selection", () => {
  assert.deepEqual(wantedPlatforms([shared, webOnly, silent], declared), ["ios", "android", "web"]);
  assert.deepEqual(wantedPlatforms([silent], declared), []);
});

test("parsePlatformFlags reads one, many, comma-separated, and ignores junk", () => {
  assert.deepEqual(parsePlatformFlags(undefined), []);
  assert.deepEqual(parsePlatformFlags("ios"), ["ios"]);
  assert.deepEqual(parsePlatformFlags(["ios,android", " web "]), ["ios", "android", "web"]);
  assert.deepEqual(parsePlatformFlags([42, ""]), []);
});

test("targetLabel names the platform only when the project has several", () => {
  const target = { surface: shared, platform: "ios" };
  assert.equal(targetLabel(target, false), "plus-upgrade");
  assert.equal(targetLabel(target, true), "plus-upgrade · ios");
});
