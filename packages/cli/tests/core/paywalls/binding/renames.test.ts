import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import type { FrameworkSurface } from "@/core/paywalls/project/framework";
import { readLock, writeApp, writeBinding } from "@/core/paywalls/project/lock";
import {
  parseRenameFlags,
  RenameError,
  resolveRenames,
  type RenameChoice,
  type RenameOrphan,
} from "@/core/paywalls/binding/renames";

const surfaceOf = (id: string, kind: "paywall" | "funnel" = "paywall"): FrameworkSurface => ({
  kind,
  id,
  dir: `/tmp/${id}`,
  configFile: `/tmp/${id}/config.ts`,
  routes: [],
});

const dirs: string[] = [];

function scaffold(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-renames-"));
  dirs.push(dir);
  writeApp(dir, "ios", "7");
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("nothing to resolve when every directory is bound", async () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "208540" });

  const result = await resolveRenames({
    superwallDir: dir,
    surfaces: [surfaceOf("plus-upgrade")],
    choose: async () => {
      throw new Error("must not ask");
    },
  });

  assert.deepEqual(result.renamed, []);
  assert.deepEqual(result.stale, []);
});

test("a chosen rename keeps the paywall id and drops the stale entry", async () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "208540" });
  const renamed = surfaceOf("pro-upgrade");

  const result = await resolveRenames({
    superwallDir: dir,
    surfaces: [renamed],
    choose: async () => ({ kind: "rename", orphanId: "plus-upgrade" }),
  });

  assert.deepEqual(result.renamed, [
    {
      kind: "paywall",
      from: "plus-upgrade",
      to: "pro-upgrade",
      bindings: { ios: { paywallId: "208540" } },
    },
  ]);
  assert.deepEqual(readLock(dir).paywalls, { "pro-upgrade": { ios: { paywallId: "208540" } } });
});

test("choosing create leaves the lock alone and reports the orphan once", async () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "208540" });
  const notices: string[] = [];

  const result = await resolveRenames({
    superwallDir: dir,
    surfaces: [surfaceOf("winback")],
    choose: async () => ({ kind: "create" }),
    notice: (message) => notices.push(message),
  });

  assert.deepEqual(result.renamed, []);
  assert.equal(result.stale.length, 1);
  assert.equal(notices.length, 1);
  assert.match(notices[0] ?? "", /`plus-upgrade` is still bound to paywall 208540/);
  assert.match(notices[0] ?? "", /remove it from superwall\.lock/);
  assert.doesNotMatch(notices[0] ?? "", /superwall (un)?link/);
});

test("choosing remove drops that entry and leaves every other binding intact", async () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "208540" });
  writeBinding(dir, "paywall", "keeper", "ios", { paywallId: "1" });
  writeBinding(dir, "funnel", "onboarding", "ios", { paywallId: "2" });
  const asked: RenameOrphan[] = [];
  const notices: string[] = [];

  const result = await resolveRenames({
    superwallDir: dir,
    surfaces: [surfaceOf("keeper"), surfaceOf("onboarding", "funnel")],
    chooseStale: async (orphan) => {
      asked.push(orphan);
      return "remove";
    },
    notice: (message) => notices.push(message),
  });

  assert.deepEqual(asked, [
    { kind: "paywall", id: "plus-upgrade", bindings: { ios: { paywallId: "208540" } } },
  ]);
  assert.deepEqual(result.dropped, [
    { kind: "paywall", id: "plus-upgrade", bindings: { ios: { paywallId: "208540" } } },
  ]);
  assert.deepEqual(result.stale, []);
  assert.deepEqual(readLock(dir).paywalls, { keeper: { ios: { paywallId: "1" } } });
  assert.deepEqual(readLock(dir).funnels, { onboarding: { ios: { paywallId: "2" } } });
  assert.deepEqual(readLock(dir).apps, { ios: "7" });
  assert.deepEqual(notices, []);
});

test("choosing keep leaves the lock byte-identical", async () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "208540" });
  const lockFile = path.join(dir, "superwall.lock");
  const before = fs.readFileSync(lockFile);

  const result = await resolveRenames({
    superwallDir: dir,
    surfaces: [],
    chooseStale: async () => "keep",
  });

  assert.deepEqual(result.dropped, []);
  assert.equal(result.stale.length, 1);
  assert.deepEqual(fs.readFileSync(lockFile), before);
});

test("a non-interactive run keeps the binding, notices it, and writes nothing", async () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "208540" });
  const lockFile = path.join(dir, "superwall.lock");
  const before = fs.readFileSync(lockFile);
  const notices: string[] = [];

  const result = await resolveRenames({
    superwallDir: dir,
    surfaces: [],
    notice: (message) => notices.push(message),
  });

  assert.deepEqual(result.dropped, []);
  assert.equal(result.stale.length, 1);
  assert.equal(notices.length, 1);
  assert.match(notices[0] ?? "", /remove it from superwall\.lock/);
  assert.deepEqual(fs.readFileSync(lockFile), before);
});

test("an orphan claimed by a rename is never offered for removal", async () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "208540" });

  const result = await resolveRenames({
    superwallDir: dir,
    surfaces: [surfaceOf("pro-upgrade")],
    choose: async () => ({ kind: "rename", orphanId: "plus-upgrade" }),
    chooseStale: async () => {
      throw new Error("must not ask about an orphan a rename already claimed");
    },
  });

  assert.equal(result.renamed.length, 1);
  assert.deepEqual(result.dropped, []);
  assert.deepEqual(result.stale, []);
  assert.deepEqual(readLock(dir).paywalls, { "pro-upgrade": { ios: { paywallId: "208540" } } });
});

test("declining the rename then removing the orphan clears it in one run", async () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "208540" });

  const result = await resolveRenames({
    superwallDir: dir,
    surfaces: [surfaceOf("winback")],
    choose: async () => ({ kind: "create" }),
    chooseStale: async () => "remove",
  });

  assert.deepEqual(result.renamed, []);
  assert.deepEqual(result.dropped, [
    { kind: "paywall", id: "plus-upgrade", bindings: { ios: { paywallId: "208540" } } },
  ]);
  assert.deepEqual(readLock(dir).paywalls, {});
});

test("multi-rename resolves each pair and never offers a consumed orphan twice", async () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "208540" });
  writeBinding(dir, "paywall", "gold-upgrade", "ios", { paywallId: "208541" });
  const offered: string[][] = [];

  const choose: RenameChoice = async ({ newcomer, orphans }) => {
    offered.push(orphans.map((orphan) => orphan.id));
    return newcomer.id === "pro-upgrade"
      ? { kind: "rename", orphanId: "plus-upgrade" }
      : { kind: "rename", orphanId: "gold-upgrade" };
  };

  const result = await resolveRenames({
    superwallDir: dir,
    surfaces: [surfaceOf("pro-upgrade"), surfaceOf("platinum-upgrade")],
    choose,
  });

  assert.deepEqual(offered, [
    ["gold-upgrade", "plus-upgrade"],
    ["gold-upgrade"],
  ]);
  assert.deepEqual(readLock(dir).paywalls, {
    "pro-upgrade": { ios: { paywallId: "208540" } },
    "platinum-upgrade": { ios: { paywallId: "208541" } },
  });
  assert.equal(result.renamed.length, 2);
});

test("a consumed orphan is gone from the pool even when the second pick is create", async () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "208540" });
  const offered: string[][] = [];

  await resolveRenames({
    superwallDir: dir,
    surfaces: [surfaceOf("pro-upgrade"), surfaceOf("winback")],
    choose: async ({ newcomer, orphans }) => {
      offered.push(orphans.map((orphan) => orphan.id));
      return newcomer.id === "pro-upgrade"
        ? { kind: "rename", orphanId: "plus-upgrade" }
        : { kind: "create" };
    },
  });

  assert.deepEqual(offered, [["plus-upgrade"]], "winback must not be asked — no orphans left");
});

test("--rename applies without any prompt", async () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "208540" });

  const result = await resolveRenames({
    superwallDir: dir,
    surfaces: [surfaceOf("pro-upgrade")],
    declared: parseRenameFlags(["plus-upgrade=pro-upgrade"]),
  });

  assert.equal(result.renamed.length, 1);
  assert.deepEqual(readLock(dir).paywalls, { "pro-upgrade": { ios: { paywallId: "208540" } } });
});

test("--rename resolves some pairs and still refuses the rest in CI", async () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "a-old", "ios", { paywallId: "1" });
  writeBinding(dir, "paywall", "b-old", "ios", { paywallId: "2" });

  await assert.rejects(
    resolveRenames({
      superwallDir: dir,
      surfaces: [surfaceOf("a-new"), surfaceOf("b-new")],
      declared: parseRenameFlags(["a-old=a-new"]),
    }),
    (error: Error) => error instanceof RenameError && /b-old=b-new/.test(error.message),
  );

  assert.equal(readLock(dir).paywalls["a-new"]?.ios?.paywallId, "1");
});

test("an unresolved pair in CI fails, naming the only escape", async () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "208540" });

  const message = await resolveRenames({
    superwallDir: dir,
    surfaces: [surfaceOf("pro-upgrade")],
  }).then(
    () => "",
    (error: Error) => error.message,
  );

  assert.match(message, /--rename plus-upgrade=pro-upgrade/);
  assert.match(message, /remove its entry from\nsuperwall\.lock by hand/);
  assert.match(message, /Refusing to create/);
  assert.doesNotMatch(message, /superwall (un)?link/);
});

test("an orphan with no newcomer never blocks — deletion is legitimate", async () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "208540" });
  writeBinding(dir, "paywall", "keeper", "ios", { paywallId: "1" });
  const notices: string[] = [];

  const result = await resolveRenames({
    superwallDir: dir,
    surfaces: [surfaceOf("keeper")],
    notice: (message) => notices.push(message),
  });

  assert.deepEqual(result.renamed, []);
  assert.deepEqual(
    result.stale.map((orphan) => orphan.id),
    ["plus-upgrade"],
  );
  assert.equal(notices.length, 1);
  assert.deepEqual(readLock(dir).paywalls["plus-upgrade"], { ios: { paywallId: "208540" } });
});

test("a newcomer with no orphans is never asked about", async () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "keeper", "ios", { paywallId: "1" });

  const result = await resolveRenames({
    superwallDir: dir,
    surfaces: [surfaceOf("keeper"), surfaceOf("winback")],
    choose: async () => {
      throw new Error("must not ask — nothing is orphaned");
    },
  });

  assert.deepEqual(result.renamed, []);
});

test("kinds never cross: a funnel newcomer ignores orphaned paywalls", async () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "208540" });

  const result = await resolveRenames({
    superwallDir: dir,
    surfaces: [surfaceOf("onboarding", "funnel")],
    choose: async () => {
      throw new Error("must not ask — the orphan is a paywall, the newcomer a funnel");
    },
    notice: () => {},
  });

  assert.deepEqual(result.renamed, []);
});

test("a funnel rename rebinds inside the funnels section", async () => {
  const dir = scaffold();
  writeBinding(dir, "funnel", "onboarding", "ios", { paywallId: "900" });

  await resolveRenames({
    superwallDir: dir,
    surfaces: [surfaceOf("onboarding-v2", "funnel")],
    choose: async () => ({ kind: "rename", orphanId: "onboarding" }),
  });

  assert.deepEqual(readLock(dir).funnels, { "onboarding-v2": { ios: { paywallId: "900" } } });
  assert.deepEqual(readLock(dir).paywalls, {});
});

test("a cancelled picker aborts instead of creating", async () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "208540" });

  await assert.rejects(
    resolveRenames({
      superwallDir: dir,
      surfaces: [surfaceOf("pro-upgrade")],
      choose: async () => {
        throw new RenameError("Cancelled — superwall.lock is unchanged and nothing was pushed.");
      },
    }),
    (error: Error) => error instanceof RenameError && /Cancelled/.test(error.message),
  );

  assert.deepEqual(readLock(dir).paywalls, { "plus-upgrade": { ios: { paywallId: "208540" } } });
});

test("--rename rejects a target that is not an unbound directory", async () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "208540" });

  await assert.rejects(
    resolveRenames({
      superwallDir: dir,
      surfaces: [surfaceOf("pro-upgrade")],
      declared: parseRenameFlags(["plus-upgrade=typo"]),
    }),
    (error: Error) => error instanceof RenameError && /no unbound directory named "typo"/.test(error.message),
  );
});

test("--rename rejects a source the lock does not hold", async () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "208540" });

  await assert.rejects(
    resolveRenames({
      superwallDir: dir,
      surfaces: [surfaceOf("pro-upgrade")],
      declared: parseRenameFlags(["nope=pro-upgrade"]),
    }),
    (error: Error) => error instanceof RenameError && /no paywall "nope"/.test(error.message),
  );
});

test("parseRenameFlags reads one, many, and rejects malformed", () => {
  assert.deepEqual(parseRenameFlags(undefined), []);
  assert.deepEqual(parseRenameFlags("a=b"), [{ from: "a", to: "b" }]);
  assert.deepEqual(parseRenameFlags(["a=b", " c = d "]), [
    { from: "a", to: "b" },
    { from: "c", to: "d" },
  ]);
  for (const bad of ["", "a", "=b", "a="]) {
    assert.throws(() => parseRenameFlags([bad]), RenameError);
  }
});

test("a rename carries every app's binding across, not just the first", async () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "1", snapshot: "s1" });
  writeBinding(dir, "paywall", "plus-upgrade", "android", { paywallId: "2" });

  const result = await resolveRenames({
    superwallDir: dir,
    surfaces: [surfaceOf("pro-upgrade")],
    declared: parseRenameFlags(["plus-upgrade=pro-upgrade"]),
  });

  assert.deepEqual(result.renamed[0]?.bindings, {
    ios: { paywallId: "1", snapshot: "s1" },
    android: { paywallId: "2" },
  });
  assert.deepEqual(readLock(dir).paywalls, {
    "pro-upgrade": { ios: { paywallId: "1", snapshot: "s1" }, android: { paywallId: "2" } },
  });
});

test("the CI error and the stale notice name every app's paywall", async () => {
  const dir = scaffold();
  writeBinding(dir, "paywall", "plus-upgrade", "ios", { paywallId: "1" });
  writeBinding(dir, "paywall", "plus-upgrade", "android", { paywallId: "2" });
  const notices: string[] = [];

  const message = await resolveRenames({ superwallDir: dir, surfaces: [surfaceOf("pro-upgrade")] }).then(
    () => "",
    (error: Error) => error.message,
  );
  assert.match(message, /plus-upgrade → paywalls 1 \(ios\), 2 \(android\)/);

  await resolveRenames({ superwallDir: dir, surfaces: [], notice: (text) => notices.push(text) });
  assert.match(notices[0] ?? "", /bound to paywalls 1 \(ios\), 2 \(android\)/);
});
