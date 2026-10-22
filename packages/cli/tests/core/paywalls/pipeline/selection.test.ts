import assert from "node:assert/strict";
import { test } from "node:test";
import {
  needsWork,
  requireClean,
  requireProject,
  resolveProjectDir,
  resolveProjectDirs,
  selectSurfaces,
} from "@/core/paywalls/pipeline/selection";
import type { FrameworkProject, FrameworkSurface } from "@/core/paywalls/project/framework";
import { selectRenderer } from "@/ui/select";

selectRenderer({ mode: "json" });

const surfaceOf = (id: string, kind: "paywall" | "funnel" = "paywall"): FrameworkSurface => ({
  kind,
  id,
  dir: `/tmp/${id}`,
  configFile: `/tmp/${id}/config.ts`,
  routes: [],
});

const projectOf = (over: Partial<FrameworkProject> = {}): FrameworkProject => ({
  root: "/tmp/app",
  superwallDir: "/tmp/app/superwall",
  marker: "package.json",
  packageName: "acme-paywalls",
  surfaces: [],
  diagnostics: [],
  ...over,
});

test("a marked project passes through unchanged", () => {
  const project = projectOf();
  assert.equal(requireProject(project, "/tmp/app"), project);
});

test("a package.json depending on superwall is what marks a project", () => {
  assert.doesNotThrow(() => requireProject(projectOf({ marker: "package.json" }), "/tmp/app"));
});

test("a markerless directory is rejected by name", () => {
  assert.throws(() => requireProject(projectOf({ marker: undefined }), "/tmp/elsewhere"), {
    message: /Not a superwall project: \/tmp\/elsewhere/,
  });
});

test("the rejection says what makes a directory a project", () => {
  assert.throws(() => requireProject(projectOf({ marker: undefined }), "/tmp/app"), {
    message: /package\.json here \(or in superwall\/\) that depends on superwall/,
  });
});

test('a project package named "superwall" is a hard error — Node would self-reference', () => {
  assert.throws(() => requireProject(projectOf({ packageName: "superwall" }), "/tmp/app"), {
    message: /is named "superwall"[\s\S]*self/,
  });
});

test("the name guard fires on a marked project", () => {
  assert.throws(
    () => requireProject(projectOf({ marker: "package.json", packageName: "superwall" }), "/tmp/app"),
    { message: /is named "superwall"/ },
  );
});

test("a missing marker is reported before the name guard", () => {
  assert.throws(
    () => requireProject(projectOf({ marker: undefined, packageName: "superwall" }), "/tmp/app"),
    { message: /Not a superwall project/ },
  );
});

test("a project without a package.json at all is fine", () => {
  assert.doesNotThrow(() => requireProject(projectOf({ packageName: undefined }), "/tmp/app"));
});

test("requireClean lets a clean selection through", () => {
  assert.doesNotThrow(() => requireClean([surfaceOf("alpha"), surfaceOf("beta")]));
  assert.doesNotThrow(() => requireClean([{ ...surfaceOf("alpha"), diagnostics: [] }]));
});

test("requireClean refuses to publish a surface with diagnostics", () => {
  const dirty = {
    ...surfaceOf("alpha"),
    diagnostics: ["paywalls/alpha: app/Card.tsx is not a route"],
  };

  assert.throws(() => requireClean([dirty]), /app\/Card\.tsx is not a route/);
  assert.throws(() => requireClean([dirty]), /Publishing is immutable/);
});

test("requireClean reports every dirty surface at once, not just the first", () => {
  const one = { ...surfaceOf("alpha"), diagnostics: ["alpha is broken"] };
  const two = { ...surfaceOf("beta"), diagnostics: ["beta is broken"] };

  assert.throws(() => requireClean([one, two]), /alpha is broken[\s\S]*beta is broken/);
});

test("requireClean ignores surfaces that were not selected — a colleague's WIP never blocks you", () => {
  const dirty = { ...surfaceOf("beta"), diagnostics: ["beta is broken"] };
  const project: FrameworkProject = {
    root: "/tmp",
    superwallDir: "/tmp",
    surfaces: [surfaceOf("alpha"), dirty],
    diagnostics: ["beta is broken"],
  };

  assert.doesNotThrow(() => requireClean(selectSurfaces(project, ["alpha"])));
  assert.throws(() => requireClean(selectSurfaces(project, [])), /beta is broken/);
});

test("resolveProjectDirs takes every directory dev was pointed at", () => {
  assert.deepEqual(resolveProjectDirs([]), [process.cwd()]);
  assert.deepEqual(resolveProjectDirs([""]), [process.cwd()]);
  assert.deepEqual(resolveProjectDirs(["/tmp/one", "/tmp/two"]), ["/tmp/one", "/tmp/two"]);
  assert.deepEqual(resolveProjectDirs(["/tmp/only"]), ["/tmp/only"]);
});

test("resolveProjectDir is the single-project form, defaulting to the current directory", () => {
  assert.equal(resolveProjectDir("/tmp/one"), "/tmp/one");
  assert.equal(resolveProjectDir(undefined), process.cwd());
});

test("selectSurfaces explains an unknown name, and an empty project", () => {
  const project: FrameworkProject = {
    root: "/tmp",
    superwallDir: "/tmp",
    surfaces: [surfaceOf("alpha"), surfaceOf("onboarding", "funnel")],
    diagnostics: [],
  };

  assert.deepEqual(
    selectSurfaces(project, ["onboarding"]).map((surface) => surface.id),
    ["onboarding"],
  );
  assert.deepEqual(selectSurfaces(project, []).length, 2);
  assert.throws(() => selectSurfaces(project, ["nope"]), /this project has: alpha, onboarding/);
  assert.throws(
    () => selectSurfaces({ ...project, surfaces: [] }, []),
    /No paywalls or funnels found/,
  );
  assert.throws(() => selectSurfaces({ ...project, surfaces: [] }, ["nope"]), /expected superwall/);
});

test("needsWork compares against the last pushed snapshot, never the live one", () => {
  const built = "a".repeat(64);
  const other = "b".repeat(64);

  assert.equal(needsWork(built, undefined, undefined), true, "never pushed");
  assert.equal(needsWork(built, other, other), true, "content differs from what was pushed");
  assert.equal(needsWork(built, built, other), false, "already pushed, even though live is older");
  assert.equal(needsWork(built, undefined, built), false, "live implies it was pushed");
  assert.equal(needsWork(built, built, built), false, "pushed and live");
});
