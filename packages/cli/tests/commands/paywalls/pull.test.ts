import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { command } from "@/commands/paywalls/pull";
import { formatLock, readLock, type LockFile } from "@/core/paywalls/project/lock";
import { helpLine, runCommand, runLine } from "../../helpers/command";
import { restoreFetch, useFetch, type Route } from "../../helpers/fetch";
import { writeFakeFrameworkProject } from "../../helpers/framework";

const apiKey = process.env.SUPERWALL_API_KEY;
const dirs: string[] = [];

afterEach(() => {
  restoreFetch();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  if (apiKey === undefined) delete process.env.SUPERWALL_API_KEY;
  else process.env.SUPERWALL_API_KEY = apiKey;
  process.exitCode = 0;
});

const temp = (prefix: string): string => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
};

function remoteWith(files: Record<string, string>): { remote: string; head: string } {
  const bare = temp("superwall-pull-cmd-bare-");
  execFileSync("git", ["init", "--bare", "--initial-branch", "main", bare]);
  const work = temp("superwall-pull-cmd-seed-");
  execFileSync("git", ["clone", "--quiet", `file://${bare}`, work], { stdio: "ignore" });
  for (const [relative, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(work, relative)), { recursive: true });
    fs.writeFileSync(path.join(work, relative), content);
  }
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-C", work, "-c", "user.name=Jom", "-c", "user.email=j@example.com", "-c", "commit.gpgsign=false", ...args],
      { encoding: "utf8" },
    );
  git("add", "-A");
  git("commit", "--quiet", "-m", "v3");
  git("push", "--quiet", "origin", "HEAD:main");
  return { remote: `file://${bare}`, head: git("rev-parse", "HEAD").trim() };
}

const sourceAccess = (remote: string): Route => ({
  match: "/source-access",
  body: { repo: "org1-app42", remote, branch: "main", token: "art_v1_x?expires=1", token_id: "tok_1" },
});

function project(lock: LockFile, files: Record<string, string> = {}): string {
  const root = writeFakeFrameworkProject();
  dirs.push(root);
  fs.writeFileSync(path.join(root, "superwall.lock"), formatLock(lock));
  for (const [relative, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), content);
  }
  return root;
}

const nicksLock = (): LockFile => ({
  version: 1,
  apps: { ios: "42" },
  paywalls: { pro: { ios: { paywallId: "208540", snapshot: "nick-v2", sourcePending: 5 } } },
  funnels: {},
});

test("pull without a login stops before touching the project, and says how to log in", async () => {
  delete process.env.SUPERWALL_API_KEY;

  const result = await runCommand(command, { args: { dir: "/nonexistent" } });

  assert.match(result.said("error")[0] ?? "", /needs a Superwall account/);
  assert.equal(process.exitCode, 1);
});

test("pull --help documents --theirs and --platform", async () => {
  const help = await helpLine("pull --help");
  assert.match(help, /--theirs +Where you and the source repo both changed a file/);
  assert.match(help, /--platform <platform…>/);
});

test("pull brings a teammate's paywall, bindings and sync point in, and keeps an unfinished version pending", async () => {
  process.env.SUPERWALL_API_KEY = "sk_live_x";
  const remoteLock = formatLock({
    version: 1,
    apps: { ios: "42" },
    paywalls: {
      pro: { ios: { paywallId: "208540", snapshot: "jom-v3" } },
      b: { ios: { paywallId: "300", snapshot: "b1" } },
    },
    funnels: {},
  });
  const { remote, head } = remoteWith({
    "package.json": JSON.stringify({ name: "acme-paywalls", dependencies: { superwall: "*" } }),
    "paywalls/b/config.ts": "export default {};\n",
    "superwall.lock": remoteLock,
  });
  const root = project(nicksLock(), { "paywalls/pro/config.ts": "nick\n" });
  const log = useFetch([sourceAccess(remote)]);

  const result = await runLine(`pull ${root}`);

  assert.deepEqual(result.said("error"), []);
  assert.equal(process.exitCode, 0);
  assert.equal(fs.readFileSync(path.join(root, "paywalls/b/config.ts"), "utf8"), "export default {};\n");
  assert.equal(fs.readFileSync(path.join(root, "paywalls/pro/config.ts"), "utf8"), "nick\n");
  const lock = readLock(root);
  assert.deepEqual(lock.paywalls.b, { ios: { paywallId: "300", snapshot: "b1" } });
  assert.deepEqual(lock.paywalls.pro, { ios: { paywallId: "208540", snapshot: "nick-v2", sourcePending: 5 } });
  assert.deepEqual(lock.sources, { "org1-app42": head });
  assert.deepEqual(
    log.map((entry) => `${entry.method} ${new URL(entry.url).pathname}`),
    ["POST /v2/paywalls/208540/source-access"],
  );
  assert.match(result.said("info").join(), /pulled 1 file[\s\S]*paywalls\/b\/config\.ts/);
});

test("a conflicting edit stops the pull with nothing changed; --theirs then takes the source repo's copy", async () => {
  process.env.SUPERWALL_API_KEY = "sk_live_x";
  const { remote, head } = remoteWith({ "paywalls/pro/config.ts": "jom\n" });
  const root = project(nicksLock(), { "paywalls/pro/config.ts": "nick\n" });
  useFetch([sourceAccess(remote)]);
  const before = fs.readFileSync(path.join(root, "superwall.lock"), "utf8");

  const refused = await runLine(`pull ${root}`);

  assert.match(refused.said("error").join(), /both changed paywalls\/pro\/config\.ts, so nothing was pulled/);
  assert.equal(fs.readFileSync(path.join(root, "paywalls/pro/config.ts"), "utf8"), "nick\n");
  assert.equal(fs.readFileSync(path.join(root, "superwall.lock"), "utf8"), before);
  process.exitCode = 0;

  const taken = await runLine(`pull ${root} --theirs`);

  assert.deepEqual(taken.said("error"), []);
  assert.equal(fs.readFileSync(path.join(root, "paywalls/pro/config.ts"), "utf8"), "jom\n");
  assert.deepEqual(readLock(root).sources, { "org1-app42": head });
});

test("an app with no local binding is pulled through its first paywall on Superwall", async () => {
  process.env.SUPERWALL_API_KEY = "sk_live_x";
  const { remote } = remoteWith({ "paywalls/b/config.ts": "b\n" });
  const root = project({ version: 1, apps: { ios: "42" }, paywalls: {}, funnels: {} });
  const log = useFetch([
    { match: "/v2/paywalls?application_id=42", body: { data: [{ id: 777 }] } },
    sourceAccess(remote),
  ]);

  const result = await runLine(`pull ${root}`);

  assert.deepEqual(result.said("error"), []);
  assert.ok(log.some((entry) => entry.url.includes("/v2/paywalls/777/source-access")));
  assert.equal(fs.readFileSync(path.join(root, "paywalls/b/config.ts"), "utf8"), "b\n");
});

test("an app with no paywall yet, or an empty source repo, has nothing to pull", async () => {
  process.env.SUPERWALL_API_KEY = "sk_live_x";
  const bare = temp("superwall-pull-empty-");
  execFileSync("git", ["init", "--bare", "--initial-branch", "main", bare]);
  const root = project({ ...nicksLock(), apps: { ios: "42", android: "7" } });
  useFetch([{ match: "/v2/paywalls?application_id=7", body: { data: [] } }, sourceAccess(`file://${bare}`)]);

  const result = await runLine(`pull ${root}`);

  assert.deepEqual(result.said("error"), []);
  const steps = result.said("step").join("\n");
  assert.match(steps, /ios app 42: its source repo is empty/);
  assert.match(steps, /android app 7: no paywall on Superwall yet/);
  assert.equal(readLock(root).sources, undefined);
});

test("a project bound to no app, or not to the --platform asked for, has no source repo to pull", async () => {
  process.env.SUPERWALL_API_KEY = "sk_live_x";
  useFetch([]);
  const unbound = project({ version: 1, apps: {}, paywalls: {}, funnels: {} });
  assert.match((await runLine(`pull ${unbound}`)).said("error").join(), /binds no app yet/);
  const ios = project(nicksLock());
  assert.match(
    (await runLine(`pull ${ios} --platform android`)).said("error").join(),
    /binds no app for android — drop --platform/,
  );
});
