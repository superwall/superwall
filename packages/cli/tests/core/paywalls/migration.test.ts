import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import {
  buildMigrationCopyPrompt,
  buildMigrationPrompt,
  isSuperwallProject,
  migrationFor,
  migrationsOf,
  projectDirOf,
} from "@/core/paywalls/migration";
import { writeOrigin } from "@/core/paywalls/project/lock";

const dirs: string[] = [];

function scratch(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sw-${name}-`));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

const ORIGIN = { paywallId: "255456", url: "https://runtime.example/store/document/abc" };

const scaffoldMigration = (superwallDir: string, withBrief = true) => {
  fs.mkdirSync(path.join(superwallDir, "paywalls", "force-update"), { recursive: true });
  writeOrigin(superwallDir, "paywall", "force-update", ORIGIN);
  if (withBrief) {
    fs.writeFileSync(
      path.join(superwallDir, "paywalls", "force-update", "MIGRATION.md"),
      "# Migrating \"Force Update\" to code\n\n- Pages: 2\n",
    );
  }
};

test("a project is recognized by its lock or its superwall dependency, nested or bare", () => {
  const root = scratch("project");
  assert.equal(projectDirOf(root), undefined);

  fs.mkdirSync(path.join(root, "superwall"));
  fs.writeFileSync(path.join(root, "superwall", "superwall.lock"), "{}");
  assert.equal(projectDirOf(root), path.join(root, "superwall"));

  const bare = scratch("bare");
  fs.writeFileSync(
    path.join(bare, "package.json"),
    JSON.stringify({ dependencies: { superwall: "latest" } }),
  );
  assert.equal(isSuperwallProject(bare), true);
  assert.equal(projectDirOf(bare), bare);

  const other = scratch("other");
  fs.writeFileSync(path.join(other, "package.json"), JSON.stringify({ name: "x" }));
  assert.equal(isSuperwallProject(other), false);
});

test("migrations are read from the lock's origins with their briefs", () => {
  const dir = scratch("migrations");
  scaffoldMigration(dir);
  writeOrigin(dir, "funnel", "quiz", { paywallId: "1", url: "https://runtime.example/q" });

  const all = migrationsOf(dir);
  assert.equal(all.length, 1);
  assert.deepEqual(all[0], {
    superwallDir: dir,
    surfaceId: "force-update",
    origin: ORIGIN,
    brief: "# Migrating \"Force Update\" to code\n\n- Pages: 2\n",
  });
  assert.equal(migrationFor(dir, "255456")?.surfaceId, "force-update");
  assert.equal(migrationFor(dir, "999"), undefined);
  assert.equal(migrationsOf(scratch("empty")).length, 0);
});

test("the prompt carries the brief, the bundled playbook, and the source, and the copy form drops the [STATUS] protocol", () => {
  const dir = scratch("prompt");
  scaffoldMigration(dir);
  const migration = migrationFor(dir, "255456");
  assert.ok(migration);

  const prompt = buildMigrationPrompt(migration);
  assert.match(prompt, /<surface_directory>paywalls\/force-update<\/surface_directory>/);
  assert.match(prompt, /<source_paywall id="255456">https:\/\/runtime\.example\/store\/document\/abc/);
  assert.match(prompt, /- Pages: 2/);
  assert.match(prompt, /Rebuild a dashboard paywall as code/);
  assert.match(prompt, /Never run `superwall push`/);
  assert.match(prompt, /\[STATUS\]/);

  const copy = buildMigrationCopyPrompt(migration);
  assert.doesNotMatch(copy, /\[STATUS\]/);
  assert.match(copy, /- Pages: 2/);
});

test("a missing brief is said out loud in the prompt rather than left blank", () => {
  const dir = scratch("nobrief");
  scaffoldMigration(dir, false);
  const migration = migrationFor(dir, "255456");
  assert.ok(migration);
  assert.equal(migration.brief, "");
  assert.match(buildMigrationPrompt(migration), /MIGRATION\.md is missing/);
});
