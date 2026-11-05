import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { bundleDir, findEntrypoint, readManifest, readProject, WorkspaceError } from "@/core/workspaces/project";
import { MANIFEST, scratch, workspaceProject } from "./fixture";

test("readProject reads the manifest from the directory it's given", () => {
  const root = workspaceProject();
  const project = readProject(root);
  assert.equal(project.root, root);
  assert.equal(project.manifest.name, MANIFEST.name);
  assert.equal(bundleDir(root), path.join(root, ".superwall", "workspace"));
});

test("readProject defaults to the current directory", () => {
  const root = workspaceProject();
  const cwd = process.cwd();
  process.chdir(root);
  try {
    assert.equal(readProject(undefined).root, root);
  } finally {
    process.chdir(cwd);
  }
});

test("a missing manifest says how to start one", () => {
  assert.throws(() => readManifest(scratch()), (error: Error) => {
    assert.ok(error instanceof WorkspaceError);
    assert.match(error.message, /superwall workspaces create/);
    return true;
  });
});

test("a manifest that isn't JSON, or lacks its fields, is refused", () => {
  const root = scratch();
  fs.writeFileSync(path.join(root, "superwall.json"), "{nope");
  assert.throws(() => readManifest(root), /not valid JSON/);
  for (const value of ["null", "{}", '{"name":"x","scopes":[]}', '{"name":1,"scopes":[],"entrypoints":[]}']) {
    fs.writeFileSync(path.join(root, "superwall.json"), value);
    assert.throws(() => readManifest(root), /needs a name, scopes and entrypoints/);
  }
});

test("findEntrypoint names the ones that exist when asked for one that doesn't", () => {
  const manifest = readProject(workspaceProject()).manifest;
  assert.equal(findEntrypoint(manifest, "count").slot, "chart.source@1");
  assert.throws(() => findEntrypoint(manifest, "nope"), /It has: home, panel, count, lift/);
  assert.throws(() => findEntrypoint({ ...manifest, entrypoints: [] }, "nope"), /It has: none/);
});
