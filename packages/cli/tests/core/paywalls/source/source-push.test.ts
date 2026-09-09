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
import { pushSource } from "@/core/paywalls/source/source-push";

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

test("a rejected commit (400) is retried the same way, then surfaces the server message", async () => {
  const fake = await fakeApi({ conflicts: 5, status: 400 });

  await assert.rejects(pushSource(input(fake)), /400/);
  assert.deepEqual(fake.calls, ["access", "link", "access", "link"]);
});

test("a second 409 gives up rather than looping", async () => {
  const fake = await fakeApi({ conflicts: 5 });

  await assert.rejects(pushSource(input(fake)), /409/);
  assert.deepEqual(fake.calls, ["access", "link", "access", "link"]);
});

test("an error that a retry cannot fix is not retried at all", async () => {
  const fake = await fakeApi({ conflicts: 5, status: 500 });

  await assert.rejects(pushSource(input(fake)), /500/);
  assert.deepEqual(fake.calls, ["access", "link"]);
});

test("without git the run stops and says to install it", async () => {
  const fake = await fakeApi();

  await assert.rejects(
    pushSource(input(fake, { hasGit: async () => false })),
    /superwall publish requires git for the source step — install git/,
  );
  assert.deepEqual(fake.calls, []);
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
