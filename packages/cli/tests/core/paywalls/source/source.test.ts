import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { collectSourceFiles } from "@/core/paywalls/source/source";

const dirs: string[] = [];

function scaffold(files: Record<string, string | Buffer>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-source-"));
  dirs.push(dir);
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return dir;
}

const PROJECT = {
  "config.ts": "export default {}\n",
  "superwall.lock": '{"version":1}\n',
  "components/Button.tsx": "export const Button = () => null\n",
  "messages/en.json": '{"title":"Hi"}\n',
  "assets/logo.svg": "<svg/>\n",
  "paywalls/plus-upgrade/config.ts": "export default {}\n",
  "paywalls/plus-upgrade/app/page.tsx": "export default () => null\n",
  "funnels/onboarding/app/page.tsx": "export default () => null\n",
};

const collect = (dir: string) => collectSourceFiles(dir);

const paths = (result: Awaited<ReturnType<typeof collect>>): string[] => {
  assert.equal(result.ok, true);
  return result.ok ? result.files.map((file) => file.path) : [];
};

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("collects every authored file, posix-relative to the superwall dir", async () => {
  assert.deepEqual(paths(await collect(scaffold(PROJECT))), Object.keys(PROJECT).sort());
});

test("build output, dependencies, secrets and OS litter never leave the machine", async () => {
  const dir = scaffold({
    ...PROJECT,
    ".superwall/build/plus-upgrade.html": "<html></html>",
    ".superwall/cache.json": "{}",
    "node_modules/superwall/index.js": "module.exports = {}",
    "components/node_modules/dep/index.js": "module.exports = {}",
    ".env": "SUPERWALL_API_KEY=sk_live_dead\n",
    ".env.local": "SECRET=1\n",
    "paywalls/plus-upgrade/.env.production": "SECRET=1\n",
    ".DS_Store": "junk",
    "assets/.DS_Store": "junk",
  });

  assert.deepEqual(paths(await collect(dir)), Object.keys(PROJECT).sort());
});

test("a .git directory inside the superwall dir is never collected", async () => {
  const dir = scaffold({ ...PROJECT, ".git/HEAD": "ref: refs/heads/main\n" });

  assert.deepEqual(paths(await collect(dir)), Object.keys(PROJECT).sort());
});

test("honors .gitignore: comments, negations, anchors, and directory rules", async () => {
  const dir = scaffold({
    ...PROJECT,
    ".gitignore": [
      "# generated",
      "dist/",
      "*.log",
      "/scratch.ts",
      "assets/large",
      "!assets/large/keep.png",
      "",
    ].join("\n"),
    "dist/bundle.js": "1",
    "paywalls/plus-upgrade/dist/bundle.js": "1",
    "debug.log": "1",
    "paywalls/plus-upgrade/debug.log": "1",
    "scratch.ts": "1",
    "assets/large/hero.png": "1",
    "paywalls/plus-upgrade/scratch.ts": "kept — the rule was anchored to the root",
  });

  assert.deepEqual(
    paths(await collect(dir)),
    [...Object.keys(PROJECT), ".gitignore", "paywalls/plus-upgrade/scratch.ts"].sort(),
  );
});

test("a project with no .gitignore at all still collects", async () => {
  assert.equal((await collect(scaffold(PROJECT))).ok, true);
});

test("a .gitignore of nothing but comments and negations excludes nothing", async () => {
  const dir = scaffold({
    ...PROJECT,
    ".gitignore": ["# only comments", "", "   ", "!keep-me", "!/also-keep"].join("\n"),
    "keep-me": "1",
  });

  assert.deepEqual(
    paths(await collect(dir)),
    [...Object.keys(PROJECT), ".gitignore", "keep-me"].sort(),
  );
});

test("a trailing-slash-only gitignore line is skipped rather than excluding everything", async () => {
  const dir = scaffold({ ...PROJECT, ".gitignore": "/\n//\n" });

  assert.deepEqual(paths(await collect(dir)), [...Object.keys(PROJECT), ".gitignore"].sort());
});

test("paths always travel posix-style, whatever the platform wrote", async () => {
  const dir = scaffold({ ...PROJECT, "deeply/nested/dir/file.ts": "export {};\n" });
  const collected = paths(await collect(dir));

  assert.ok(collected.includes("deeply/nested/dir/file.ts"));
  assert.ok(!collected.some((file) => file.includes("\\")));
});

test("binary content is carried verbatim, byte for byte", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe]);
  const result = await collect(scaffold({ ...PROJECT, "assets/icon.png": png }));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.files.find((file) => file.path === "assets/icon.png")?.content,
    png,
  );
});

test("a file far past any upload cap is collected like any other", async () => {
  const huge = Buffer.alloc(12 * 1024 * 1024, 7);
  const result = await collect(scaffold({ ...PROJECT, "assets/hero.mp4": huge }));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    result.files.find((file) => file.path === "assets/hero.mp4")?.content.byteLength,
    huge.byteLength,
  );
});

test("an empty superwall dir is a failure, not an empty push", async () => {
  const result = await collect(scaffold({}));

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /No source files/);
});
