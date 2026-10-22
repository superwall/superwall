import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { createSuperwallApi } from "@/core/api/client";
import type { SuperwallApi } from "@/core/api/client";
import type { SourceFile } from "@/core/paywalls/source/source";
import { readLock } from "@/core/paywalls/project/lock";
import { readSourceBase } from "@/core/paywalls/source/base";
import { SourceConflictError } from "@/core/paywalls/source/git";
import { assertGit, pushSource } from "@/core/paywalls/source/source-push";

const dirs: string[] = [];
const servers: http.Server[] = [];

const temp = (prefix: string): string => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
};

const file = (relative: string, content: string | Buffer): SourceFile => ({
  path: relative,
  content: typeof content === "string" ? Buffer.from(content) : content,
});

interface Fake {
  calls: string[];
  bodies: Record<string, unknown>;
  conflicts: number;
  api: SuperwallApi;
  remote: string;
  bare: string;
}

async function fakeApi(options: { conflicts?: number; status?: number } = {}): Promise<Fake> {
  const bare = temp("superwall-bare-");
  execFileSync("git", ["init", "--bare", "--initial-branch", "main", bare]);

  const fake: Fake = {
    calls: [],
    bodies: {},
    conflicts: options.conflicts ?? 0,
    api: createSuperwallApi({} as never),
    remote: `file://${bare}`,
    bare,
  };

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += String(chunk)));
    req.on("end", () => {
      const url = req.url ?? "";
      const send = (status: number, value: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
      };

      if (url.endsWith("/source-access")) {
        fake.calls.push("access");
        return send(200, {
          object: "paywall.source_access",
          id: "sa_1",
          repo: "org1-app42",
          remote: fake.remote,
          branch: "main",
          token: "art_v1_deadbeefcafebabe?expires=1790000000",
          token_id: "tok_1",
          expires_at: "2030-01-01T00:00:00Z",
        });
      }
      if (url.endsWith("/source-commit")) {
        fake.calls.push("link");
        fake.bodies.link = JSON.parse(raw || "{}");
        if (fake.conflicts > 0) {
          fake.conflicts -= 1;
          return send(options.status ?? 409, { error: "head moved" });
        }
        return send(200, { object: "paywall.source_commit", commit_sha: "x" });
      }
      send(404, {});
    });
  });

  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  fake.api = createSuperwallApi({
    authMethod: "api_key",
    apiKey: "sk_test",
    host: `http://127.0.0.1:${port}`,
    createdAt: new Date().toISOString(),
  });
  return fake;
}

const input = (fake: Fake, over: Record<string, unknown> = {}) => ({
  api: fake.api,
  superwallDir: temp("superwall-project-"),
  paywallId: "208540",
  applicationId: "42",
  version: 7,
  files: [file("config.ts", "export default {};\n")],
  framework: "0.4.2",
  surface: "plus-upgrade",
  kind: "paywall" as const,
  cli: "1.0.0",
  ...over,
});

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the default path is a direct git push, then a link", async () => {
  const fake = await fakeApi();

  const result = await pushSource(input(fake));

  assert.deepEqual(fake.calls, ["access", "link"]);
  assert.equal(result.status, "committed");
  assert.match(result.commitSha, /^[a-f0-9]{40}$/);
  assert.deepEqual(fake.bodies.link, { commit_sha: result.commitSha, token_id: "tok_1" });
});

test("a 409 is retried once, minting a fresh token first", async () => {
  const fake = await fakeApi({ conflicts: 1 });

  const result = await pushSource(input(fake));

  assert.deepEqual(fake.calls, ["access", "link", "access", "link"]);
  assert.equal(result.status, "unchanged");
});

test("a rejected commit (400) is not retried — the same tree would be rejected again", async () => {
  const fake = await fakeApi({ conflicts: 5, status: 400 });

  await assert.rejects(pushSource(input(fake)), /400/);
  assert.deepEqual(fake.calls, ["access", "link"]);
});

test("a second 409 gives up rather than looping", async () => {
  const fake = await fakeApi({ conflicts: 5 });

  await assert.rejects(pushSource(input(fake)), /409/);
  assert.deepEqual(fake.calls, ["access", "link", "access", "link"]);
});

test("a transient link failure retries only the link, never the push", async () => {
  const fake = await fakeApi({ conflicts: 1, status: 503 });

  const result = await pushSource(input(fake));

  assert.deepEqual(fake.calls, ["access", "link", "link"]);
  assert.equal(result.status, "committed");
});

test("an error that a retry cannot fix is not retried at all", async () => {
  const fake = await fakeApi({ conflicts: 5, status: 422 });

  await assert.rejects(pushSource(input(fake)), /422/);
  assert.deepEqual(fake.calls, ["access", "link"]);
});

test("without git the run stops and says to install it", async () => {
  await assert.rejects(
    assertGit(async () => false),
    /superwall publish requires git for the source step — install git/,
  );
  await assertGit(async () => true);
});

test("a tree far past any old upload cap goes straight through", async () => {
  const fake = await fakeApi();

  const result = await pushSource(
    input(fake, { files: [file("huge.bin", Buffer.alloc(12 * 1024 * 1024, 3))] }),
  );

  assert.equal(result.status, "committed");
  assert.deepEqual(fake.calls, ["access", "link"]);
  const tracked = execFileSync(
    "git",
    ["--git-dir", fake.bare, "ls-tree", "-r", "--name-only", "main"],
    { encoding: "utf8" },
  );
  assert.match(tracked, /huge\.bin/);
});

test("the publish note reaches the commit on the direct path too", async () => {
  const fake = await fakeApi();

  await pushSource(input(fake, { note: "Ship the Q3 test" }));

  const shown = execFileSync("git", ["--git-dir", fake.bare, "show", "main"], {
    encoding: "utf8",
  });
  assert.match(shown, /Ship the Q3 test/);
});

const commitOf = (bare: string): string =>
  execFileSync("git", ["--git-dir", bare, "show", "main"], { encoding: "utf8" });

test("a self-contained push records the project as portable", async () => {
  const fake = await fakeApi();

  await pushSource(input(fake, {}));

  const shown = commitOf(fake.bare);
  assert.match(shown, /Superwall-Portable: true/);
  assert.ok(!shown.includes("Superwall-External"));
});

test("out-of-tree imports reach the commit as portability metadata", async () => {
  const fake = await fakeApi();

  await pushSource(input(fake, { external: ["../src/theme.ts", "../packages/ui/index.tsx"] }));

  const shown = commitOf(fake.bare);
  assert.match(shown, /Superwall-Portable: false/);
  assert.match(shown, /Superwall-External: \.\.\/src\/theme\.ts, \.\.\/packages\/ui\/index\.tsx/);
});

test("nothing generated joins the tree — the manifest is gone", async () => {
  const fake = await fakeApi();

  await pushSource(input(fake, {}));

  const tracked = execFileSync(
    "git",
    ["--git-dir", fake.bare, "ls-tree", "-r", "--name-only", "main"],
    { encoding: "utf8" },
  );
  assert.ok(!tracked.includes(".superwall-manifest.json"));
});

const tracked = (bare: string): string[] =>
  execFileSync("git", ["--git-dir", bare, "ls-tree", "-r", "--name-only", "main"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean)
    .sort();

const blob = (bare: string, file: string): string =>
  execFileSync("git", ["--git-dir", bare, "show", `main:${file}`], { encoding: "utf8" });

test("a push records the commit it landed as the project's base", async () => {
  const fake = await fakeApi();
  const superwallDir = temp("superwall-project-");

  const result = await pushSource(input(fake, { superwallDir }));

  assert.equal(readSourceBase(superwallDir, "org1-app42"), result.commitSha);
  assert.deepEqual(readLock(superwallDir).sources, { "org1-app42": result.commitSha });
  assert.equal(result.syncedTo, result.commitSha);
});

test("a fresh checkout reads the base from the committed lock, so a teammate's push merges instead of erasing", async () => {
  const fake = await fakeApi();
  const alice = temp("superwall-alice-");
  const ci = temp("superwall-ci-");
  const shared = file("config.ts", "export default {};\n");

  await pushSource(input(fake, { superwallDir: alice, files: [shared] }));
  fs.copyFileSync(path.join(alice, "superwall.lock"), path.join(ci, "superwall.lock"));
  await pushSource(
    input(fake, { superwallDir: alice, files: [shared, file("paywalls/a/app/index.tsx", "a\n")] }),
  );
  await pushSource(
    input(fake, { superwallDir: ci, files: [shared, file("paywalls/b/app/index.tsx", "b\n")] }),
  );

  assert.deepEqual(tracked(fake.bare), ["config.ts", "paywalls/a/app/index.tsx", "paywalls/b/app/index.tsx"]);
});

test("the old .superwall/source.json is still read, then moved into the lock", async () => {
  const fake = await fakeApi();
  const superwallDir = temp("superwall-project-");
  const first = await pushSource(input(fake, { superwallDir }));
  const legacy = path.join(superwallDir, ".superwall", "source.json");
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(
    legacy,
    JSON.stringify({ version: 1, repos: { "org1-app42": first.commitSha, "org1-app43": "b".repeat(40) } }),
  );
  fs.rmSync(path.join(superwallDir, "superwall.lock"));

  assert.equal(readSourceBase(superwallDir, "org1-app42"), first.commitSha);
  const second = await pushSource(input(fake, { superwallDir, files: [file("config.ts", "next\n")] }));

  assert.equal(second.status, "committed");
  assert.deepEqual(readLock(superwallDir).sources, {
    "org1-app42": second.commitSha,
    "org1-app43": "b".repeat(40),
  });
  assert.equal(fs.existsSync(legacy), false);
});

test("a corrupt base file stops the push instead of reading as no base", async () => {
  const fake = await fakeApi();
  const superwallDir = temp("superwall-project-");
  fs.mkdirSync(path.join(superwallDir, ".superwall"));
  fs.writeFileSync(path.join(superwallDir, ".superwall", "source.json"), "{ nope");

  await assert.rejects(pushSource(input(fake, { superwallDir })), /Can't read .*source\.json .* fix or delete it/);
  fs.writeFileSync(path.join(superwallDir, ".superwall", "source.json"), "[]");
  assert.throws(() => readSourceBase(superwallDir, "org1-app42"), /isn't a source sync record/);
});

test("a link that fails after the git push still advances the base, so the next push is no false conflict", async () => {
  const fake = await fakeApi();
  const superwallDir = temp("superwall-project-");

  await pushSource(input(fake, { superwallDir, files: [file("config.ts", "one\n")] }));
  fake.conflicts = 5;
  await assert.rejects(
    pushSource(input(fake, { superwallDir, files: [file("config.ts", "two\n")] })),
    /409/,
  );
  const landed = execFileSync("git", ["--git-dir", fake.bare, "rev-parse", "main"], { encoding: "utf8" }).trim();
  assert.equal(readSourceBase(superwallDir, "org1-app42"), landed);

  fake.conflicts = 0;
  const third = await pushSource(input(fake, { superwallDir, files: [file("config.ts", "three\n")] }));

  assert.equal(third.status, "committed");
  assert.equal(blob(fake.bare, "config.ts"), "three\n");
});

test("a link that never succeeds on the first push leaves a base the next push can build on", async () => {
  const fake = await fakeApi({ conflicts: 5, status: 422 });
  const superwallDir = temp("superwall-project-");

  await assert.rejects(pushSource(input(fake, { superwallDir, files: [file("config.ts", "one\n")] })), /422/);
  fake.conflicts = 0;
  const second = await pushSource(input(fake, { superwallDir, files: [file("config.ts", "two\n")] }));

  assert.equal(second.status, "committed");
  assert.equal(blob(fake.bare, "config.ts"), "two\n");
});

test("two projects publishing different paywalls both survive", async () => {
  const fake = await fakeApi();
  const alice = temp("superwall-alice-");
  const bob = temp("superwall-bob-");
  const shared = file("config.ts", "export default {};\n");

  await pushSource(input(fake, { superwallDir: alice, files: [shared] }));
  await pushSource(input(fake, { superwallDir: bob, files: [shared] }));

  await pushSource(
    input(fake, {
      superwallDir: alice,
      files: [shared, file("paywalls/a/app/index.tsx", "alice\n")],
    }),
  );
  await pushSource(
    input(fake, { superwallDir: bob, files: [shared, file("paywalls/b/app/index.tsx", "bob\n")] }),
  );

  assert.deepEqual(tracked(fake.bare), [
    "config.ts",
    "paywalls/a/app/index.tsx",
    "paywalls/b/app/index.tsx",
  ]);
});

test("pushing again after being rebased over a teammate keeps the teammate's paywall", async () => {
  const fake = await fakeApi();
  const alice = temp("superwall-alice-");
  const bob = temp("superwall-bob-");
  const shared = file("config.ts", "export default {};\n");
  const bobs = file("paywalls/b/app/index.tsx", "bob\n");

  await pushSource(input(fake, { superwallDir: alice, files: [shared] }));
  await pushSource(input(fake, { superwallDir: bob, files: [shared] }));
  await pushSource(input(fake, { superwallDir: bob, files: [shared, bobs] }));
  await pushSource(
    input(fake, { superwallDir: alice, files: [shared, file("paywalls/a/app/index.tsx", "a1\n")] }),
  );
  await pushSource(
    input(fake, { superwallDir: alice, files: [shared, file("paywalls/a/app/index.tsx", "a2\n")] }),
  );

  assert.deepEqual(tracked(fake.bare), [
    "config.ts",
    "paywalls/a/app/index.tsx",
    "paywalls/b/app/index.tsx",
  ]);
  assert.equal(blob(fake.bare, "paywalls/a/app/index.tsx"), "a2\n");
});

test("a deletion only removes what this project deleted, not what it never saw", async () => {
  const fake = await fakeApi();
  const alice = temp("superwall-alice-");
  const bob = temp("superwall-bob-");
  const shared = file("config.ts", "export default {};\n");
  const old = file("paywalls/old/app/index.tsx", "old\n");

  await pushSource(input(fake, { superwallDir: alice, files: [shared, old] }));
  await pushSource(input(fake, { superwallDir: bob, files: [shared, old] }));
  await pushSource(
    input(fake, {
      superwallDir: alice,
      files: [shared, old, file("paywalls/new/app/index.tsx", "new\n")],
    }),
  );
  await pushSource(input(fake, { superwallDir: bob, files: [shared] }));

  assert.deepEqual(tracked(fake.bare), ["config.ts", "paywalls/new/app/index.tsx"]);
});

test("the same file changed two ways is refused, naming it, and nothing lands", async () => {
  const fake = await fakeApi();
  const alice = temp("superwall-alice-");
  const bob = temp("superwall-bob-");

  await pushSource(input(fake, { superwallDir: alice, files: [file("config.ts", "one\n")] }));
  await pushSource(input(fake, { superwallDir: bob, files: [file("config.ts", "one\n")] }));
  await pushSource(input(fake, { superwallDir: alice, files: [file("config.ts", "alice\n")] }));

  await assert.rejects(
    pushSource(input(fake, { superwallDir: bob, files: [file("config.ts", "bob\n")] })),
    (error: unknown) => error instanceof SourceConflictError && error.files.join() === "config.ts",
  );
  assert.equal(blob(fake.bare, "config.ts"), "alice\n");
});

test("a 409 retry lands on top of the other publish instead of reverting it", async () => {
  const fake = await fakeApi();
  const alice = temp("superwall-alice-");
  const bob = temp("superwall-bob-");
  const shared = file("config.ts", "export default {};\n");

  await pushSource(input(fake, { superwallDir: alice, files: [shared] }));
  await pushSource(input(fake, { superwallDir: bob, files: [shared] }));
  await pushSource(
    input(fake, {
      superwallDir: alice,
      files: [shared, file("paywalls/a/app/index.tsx", "alice\n")],
    }),
  );
  fake.conflicts = 1;
  await pushSource(
    input(fake, { superwallDir: bob, files: [shared, file("paywalls/b/app/index.tsx", "bob\n")] }),
  );

  assert.deepEqual(tracked(fake.bare), [
    "config.ts",
    "paywalls/a/app/index.tsx",
    "paywalls/b/app/index.tsx",
  ]);
});
