import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { projectPackageName, writeProjectScaffold } from "@/core/paywalls/project/scaffold";

const dirs: string[] = [];

function tmp(name = "app"): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-scaffold-"));
  dirs.push(base);
  const root = path.join(base, name);
  fs.mkdirSync(path.join(root, "superwall"), { recursive: true });
  return root;
}

const scaffold = (root: string, frameworkVersion = "1.2.3") => {
  writeProjectScaffold({
    root,
    superwallDir: path.join(root, "superwall"),
    frameworkVersion,
  });
  return path.join(root, "superwall");
};

const readPackage = (superwallDir: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(superwallDir, "package.json"), "utf8"));

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("writes an installable package.json named after the project root", () => {
  const dir = scaffold(tmp("my-app"));
  const pkg = readPackage(dir);

  assert.equal(pkg.name, "my-app");
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, "module");
  assert.deepEqual(pkg.dependencies, {
    react: "19.1.0",
    "react-dom": "19.1.0",
    superwall: "^1.2.3",
  });
});

test("the scripts run through the framework's own bin", () => {
  const pkg = readPackage(scaffold(tmp()));
  assert.deepEqual(pkg.scripts, {
    dev: "superwall dev",
    push: "superwall push",
    promote: "superwall promote",
    ship: "superwall publish",
  });
});

test("no @superwall/cli devDependency — the bin ships with the framework", () => {
  const pkg = readPackage(scaffold(tmp()));
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(Object.keys(pkg.dependencies as object).includes("@superwall/cli"), false);
});

test("an undetectable framework version pins nothing rather than lying", () => {
  const pkg = readPackage(scaffold(tmp(), "unknown"));
  assert.equal((pkg.dependencies as Record<string, string>).superwall, "*");
});

test("writes a .gitignore covering the three never-captured paths", () => {
  const dir = scaffold(tmp());
  const lines = fs.readFileSync(path.join(dir, ".gitignore"), "utf8").split("\n").filter(Boolean);
  assert.deepEqual(lines, ["node_modules/", ".superwall", ".env"]);
});

test("never overwrites a package.json the user owns", () => {
  const root = tmp();
  const file = path.join(root, "superwall", "package.json");
  fs.writeFileSync(file, '{"name":"mine"}');

  scaffold(root);

  assert.equal(fs.readFileSync(file, "utf8"), '{"name":"mine"}');
});

test("never overwrites an existing .gitignore", () => {
  const root = tmp();
  const file = path.join(root, "superwall", ".gitignore");
  fs.writeFileSync(file, "custom\n");

  scaffold(root);

  assert.equal(fs.readFileSync(file, "utf8"), "custom\n");
});

test("writes the missing file even when the other one is already there", () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, "superwall", "package.json"), '{"name":"mine"}');

  const dir = scaffold(root);

  assert.equal(fs.existsSync(path.join(dir, ".gitignore")), true);
});

test("a bare-root project scaffolds in place", () => {
  const root = tmp("dedicated-repo");
  writeProjectScaffold({ root, superwallDir: root, frameworkVersion: "1.0.0" });

  assert.equal(
    (JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { name: string }).name,
    "dedicated-repo",
  );
});

test("a failure to write is swallowed — scaffolding never fails a command", () => {
  const root = tmp();
  fs.rmSync(path.join(root, "superwall"), { recursive: true, force: true });

  assert.doesNotThrow(() => scaffold(root));
});

test("sanitizes a directory name into a legal package name", () => {
  assert.equal(projectPackageName("/x/My App"), "my-app");
  assert.equal(projectPackageName("/x/ACME_Paywalls"), "acme_paywalls");
  assert.equal(projectPackageName("/x/weird!!!name"), "weird-name");
  assert.equal(projectPackageName("/x/--leading-trailing--"), "leading-trailing");
  assert.equal(projectPackageName("/x/über-app"), "ber-app");
});

test('never names the package "superwall" — Node would self-reference', () => {
  assert.equal(projectPackageName("/x/superwall"), "superwall-project");
  assert.equal(projectPackageName("/x/SuperWall"), "superwall-project");
  assert.equal(projectPackageName("/x/!!!"), "superwall-project");
});

test("the scaffolded name always survives the discovery name guard", () => {
  for (const name of ["superwall", "SUPERWALL", "...", "my-app"]) {
    assert.notEqual(projectPackageName(`/x/${name}`), "superwall");
  }
});
