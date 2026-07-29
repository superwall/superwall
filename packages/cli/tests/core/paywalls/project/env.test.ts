import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { ENV_TYPES_FILE, writeEnvTypes } from "@/core/paywalls/project/env";

const dirs: string[] = [];

function scaffold(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-env-"));
  dirs.push(dir);
  return dir;
}

const read = (dir: string) => fs.readFileSync(path.join(dir, ENV_TYPES_FILE), "utf8");

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("scaffolds the ambient asset types when the project has none", () => {
  const dir = scaffold();
  writeEnvTypes(dir);

  const written = read(dir);
  assert.match(written, /^\/\/\/ <reference types="superwall\/assets" \/>/);
  assert.match(written, /Managed by the Superwall CLI/);
});

test("never overwrites a file the project already owns", () => {
  const dir = scaffold();
  const mine = '/// <reference types="superwall/assets" />\ndeclare module "*.lottie";\n';
  fs.writeFileSync(path.join(dir, ENV_TYPES_FILE), mine);

  writeEnvTypes(dir);
  writeEnvTypes(dir);

  assert.equal(read(dir), mine);
});

test("writing twice is a no-op, not a duplicate", () => {
  const dir = scaffold();
  writeEnvTypes(dir);
  const first = read(dir);
  writeEnvTypes(dir);

  assert.equal(read(dir), first);
});

test("an unwritable project never fails the command", () => {
  const dir = scaffold();
  const readOnly = path.join(dir, "locked");
  fs.mkdirSync(readOnly);
  fs.chmodSync(readOnly, 0o500);

  assert.doesNotThrow(() => writeEnvTypes(readOnly));
  assert.equal(fs.existsSync(path.join(readOnly, ENV_TYPES_FILE)), false);

  fs.chmodSync(readOnly, 0o700);
});
