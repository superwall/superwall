import assert from "node:assert/strict";
import { test } from "node:test";
import { requireProject } from "@/commands/paywalls/pipeline";
import type { FrameworkProject } from "@/core/paywalls/project/framework";
import { selectRenderer } from "@/ui";

selectRenderer({ mode: "json" });

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
