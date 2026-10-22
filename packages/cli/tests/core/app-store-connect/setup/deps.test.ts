import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { appleDeps } from "@/core/app-store-connect/setup/deps";
import { PENDING } from "../../../helpers/apple-setup";
import { clearHomes, useHome } from "../../../helpers/home";

const cwd = process.cwd();
const dirs: string[] = [];

afterEach(() => {
  process.chdir(cwd);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  clearHomes();
});

test("a kept key is written to the current directory, readable only by its owner", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "superwall-deps-")));
  dirs.push(dir);
  process.chdir(dir);

  const path = appleDeps.writeKeyFile("AuthKey_ABC.p8", "PEM");

  assert.equal(path, join(dir, "AuthKey_ABC.p8"));
  assert.equal(readFileSync(path, "utf8"), "PEM");
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test("a pending sign-in is saved in the Superwall home, read back, and cleared", () => {
  const home = useHome();

  assert.equal(appleDeps.pending.load(), undefined);
  appleDeps.pending.save(PENDING);
  assert.equal(statSync(join(home, "apple-sign-in.json")).mode & 0o777, 0o600);
  assert.deepEqual(appleDeps.pending.load(), PENDING);
  appleDeps.pending.clear();
  assert.equal(appleDeps.pending.load(), undefined);
});

test("waiting for Apple sleeps for the time asked", async () => {
  const start = Date.now();
  await appleDeps.sleep(30);
  assert.ok(Date.now() - start >= 25);
});
