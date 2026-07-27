import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { createStudioActions } from "@/commands/paywalls/studio-actions";
import type { Framework, FrameworkProject, FrameworkSurface } from "@/core/paywalls/framework";
import { writeBinding } from "@/core/paywalls/lock";

const dirs: string[] = [];
const savedEnv = { ...process.env };

function scaffold(): FrameworkProject {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-studio-actions-"));
  dirs.push(dir);
  return { root: dir, superwallDir: dir, surfaces: [], diagnostics: [] };
}

const surface: FrameworkSurface = { kind: "paywall", id: "plus-upgrade", dir: "/tmp/x", pages: [] };

const framework: Framework = {
  discoverProject: () => {
    throw new Error("unused");
  },
  buildSnapshot: async () => ({ snapshotId: "abc", html: "<html></html>", bytes: 13, htmlFile: "x" }),
  startPreviewServer: async () => ({}),
};

afterEach(() => {
  process.env = { ...savedEnv };
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("run without credentials fails with the login guidance, never throws", async () => {
  delete process.env.SUPERWALL_API_KEY;
  // os.homedir() honors HOME on POSIX — point it at an empty dir so the
  // developer's real ~/.superwall session can't leak into the test.
  process.env.HOME = scaffold().root;

  const actions = createStudioActions(framework, scaffold());
  const result = await actions.run("push", surface);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /superwall login|SUPERWALL_API_KEY/);
  }
});

test("run surfaces an unreachable API as a message", async () => {
  process.env.SUPERWALL_API_KEY = "sk_test_dead";
  process.env.SUPERWALL_API_HOST = "http://127.0.0.1:1";

  const project = scaffold();
  writeBinding(project.superwallDir, "paywall", "plus-upgrade", { paywallId: "208540" });
  const actions = createStudioActions(framework, project);
  const result = await actions.run("push", surface);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Couldn't reach the Superwall API/);
  }
});

test("status is empty for an unbound surface and never throws", async () => {
  const actions = createStudioActions(framework, scaffold());
  assert.deepEqual(await actions.status(surface), {});
});

test("status swallows API failures", async () => {
  process.env.SUPERWALL_API_KEY = "sk_test_dead";
  process.env.SUPERWALL_API_HOST = "http://127.0.0.1:1";

  const project = scaffold();
  writeBinding(project.superwallDir, "paywall", "plus-upgrade", { paywallId: "208540" });
  const actions = createStudioActions(framework, project);
  assert.deepEqual(await actions.status(surface), {});
});
