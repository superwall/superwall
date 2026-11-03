import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { cloneInto, pullInto } from "@/core/paywalls/pull";
import { readLock, writeBinding, writeLock, type SurfaceKind } from "@/core/paywalls/project/lock";
import { readSourceBase, writeSourceBase } from "@/core/paywalls/source/base";
import {
  PullConflictError,
  pushSourceTree,
  SourceConflictError,
  SourceDivergedError,
} from "@/core/paywalls/source/git";
import { collectSourceFiles } from "@/core/paywalls/source/source";
import { silentRenderer, useRenderer } from "@/ui";

useRenderer(silentRenderer);

const REPO = "org1-app42";
const dirs: string[] = [];

const temp = (prefix: string): string => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

interface Remote {
  dir: string;
  access: { repo: string; remote: string; branch: string; token: string; tokenId: string };
}

function sourceRepo(): Remote {
  const dir = temp("superwall-collab-bare-");
  execFileSync("git", ["init", "--quiet", "--bare", "--initial-branch", "main", dir]);
  return {
    dir,
    access: { repo: REPO, remote: `file://${dir}`, branch: "main", token: "art_v1_collab?expires=1790000000", tokenId: "tok_1" },
  };
}

const gitDir = (remote: Remote, ...args: string[]): string =>
  execFileSync("git", ["--git-dir", remote.dir, ...args], { encoding: "utf8" });

const headOf = (remote: Remote): string | undefined => {
  try {
    return gitDir(remote, "rev-parse", "--verify", "--quiet", "main").trim();
  } catch {
    return undefined;
  }
};

function repoTree(remote: Remote): Map<string, string> {
  const tree = new Map<string, string>();
  if (headOf(remote) === undefined) return tree;
  for (const file of gitDir(remote, "ls-tree", "-r", "--name-only", "-z", "main").split("\0").filter(Boolean)) {
    tree.set(file, gitDir(remote, "show", `main:${file}`));
  }
  return tree;
}

const CONFLICT_MARKER = /^(<{7}|={7}|>{7})( |$)/m;

function snapshot(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (at: string) => {
    for (const entry of fs.readdirSync(path.join(dir, at), { withFileTypes: true })) {
      const relative = at ? `${at}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(relative);
      else files.set(relative, fs.readFileSync(path.join(dir, relative), "latin1"));
    }
  };
  walk("");
  return files;
}

function assertNoConflictMarkers(where: string, files: Map<string, string>): void {
  for (const [file, content] of files) {
    assert.doesNotMatch(content, CONFLICT_MARKER, `${where}: ${file} holds conflict markers`);
  }
}

const sourceFiles = (files: Map<string, string>): Map<string, string> =>
  new Map([...files].filter(([file]) => file !== "superwall.lock" && file !== "superwall.d.ts"));

let pushes = 0;

class Teammate {
  readonly dir: string;

  constructor(
    readonly name: string,
    readonly remote: Remote,
    options: { empty?: boolean } = {},
  ) {
    this.dir = temp(`superwall-collab-${name}-`);
    if (options.empty) return;
    writeLock(this.dir, { version: 1, apps: { ios: "42" }, paywalls: {}, funnels: {} });
    this.write("package.json", '{ "name": "superwall" }\n');
  }

  write(relative: string, content: string | Buffer): this {
    const target = path.join(this.dir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    return this;
  }

  remove(relative: string): this {
    fs.rmSync(path.join(this.dir, relative), { recursive: true, force: true });
    return this;
  }

  read(relative: string): string | undefined {
    const target = path.join(this.dir, relative);
    return fs.existsSync(target) ? fs.readFileSync(target, "utf8") : undefined;
  }

  base(): string | undefined {
    return readSourceBase(this.dir, REPO);
  }

  bind(id: string, kind: SurfaceKind = "paywall", sourcePending?: number): this {
    writeBinding(this.dir, kind, id, "ios", {
      paywallId: `${kind === "paywall" ? 1 : 2}${id.length}${id.charCodeAt(0)}`,
      snapshot: `${this.name}-${++pushes}`,
      ...(sourcePending === undefined ? {} : { sourcePending }),
    });
    return this;
  }

  async push(id: string, options: { kind?: SurfaceKind; overwrite?: boolean } = {}) {
    const kind = options.kind ?? "paywall";
    const section = kind === "paywall" ? readLock(this.dir).paywalls : readLock(this.dir).funnels;
    if (!section[id]?.ios) this.bind(id, kind);
    const collected = await collectSourceFiles(this.dir);
    if (!collected.ok) throw new Error(collected.reason);
    const pushed = await pushSourceTree({
      access: this.remote.access,
      base: this.base(),
      overwrite: options.overwrite,
      files: collected.files,
      message: { kind, surface: id, version: pushes, paywallId: "1", applicationId: "42", framework: "0.4.2" },
    });
    if (pushed.syncedTo) writeSourceBase(this.dir, REPO, pushed.syncedTo);
    return pushed;
  }

  async pull(options: { theirs?: boolean } = {}) {
    return pullInto(this.dir, this.remote.access, options.theirs === true);
  }

  async clone() {
    return cloneInto(this.dir, this.remote.access, { ios: "42" });
  }
}

const team = (...names: string[]) => {
  const remote = sourceRepo();
  return { remote, people: names.map((name) => new Teammate(name, remote)) };
};

const paywall = (body: string) => `export default function Paywall() {\n  return "${body}";\n}\n`;

const lines = (count: number, edits: Record<number, string> = {}) =>
  Array.from({ length: count }, (_, index) => edits[index] ?? `line ${index}`).join("\n") + "\n";

async function refusedWithoutChange(
  who: Teammate,
  action: () => Promise<unknown>,
  check: (error: unknown) => boolean,
): Promise<void> {
  const before = snapshot(who.dir);
  const head = headOf(who.remote);
  await assert.rejects(action, check);
  assert.deepEqual(snapshot(who.dir), before, `${who.name}'s project is unchanged`);
  assert.equal(headOf(who.remote), head, "the source repo is unchanged");
}

test("Nick's case: Jom's v3 refuses Nick's publish, pull --theirs brings it in, and both keep working from there", async () => {
  const { remote, people } = team("nick", "jom");
  const [nick, jom] = people;
  assert.ok(nick && jom);

  nick.write("paywalls/a/index.tsx", paywall("v1"));
  await nick.push("a");
  nick.write("paywalls/a/index.tsx", paywall("v2"));
  await nick.push("a");

  const jomDir = new Teammate("jom-laptop", remote, { empty: true });
  assert.ok((await jomDir.clone())?.includes("paywalls/a/index.tsx"));
  assert.equal(jomDir.read("paywalls/a/index.tsx"), paywall("v2"));
  jomDir.write("paywalls/a/index.tsx", paywall("v3 by jom"));
  await jomDir.push("a");

  nick.write("paywalls/a/index.tsx", paywall("v4 by nick"));
  await refusedWithoutChange(
    nick,
    () => nick.push("a"),
    (error) => error instanceof SourceConflictError && error.files.join() === "paywalls/a/index.tsx",
  );
  await refusedWithoutChange(
    nick,
    () => nick.pull(),
    (error) => error instanceof PullConflictError && error.files.join() === "paywalls/a/index.tsx",
  );

  await nick.pull({ theirs: true });
  assert.equal(nick.read("paywalls/a/index.tsx"), paywall("v3 by jom"));
  nick.write("paywalls/a/index.tsx", paywall("v5 by nick, on top of v3"));
  assert.equal((await nick.push("a")).status, "committed");
  assert.equal(repoTree(remote).get("paywalls/a/index.tsx"), paywall("v5 by nick, on top of v3"));

  await jomDir.pull();
  assert.equal(jomDir.read("paywalls/a/index.tsx"), paywall("v5 by nick, on top of v3"));
  assertNoConflictMarkers("repo", repoTree(remote));
});

test("teammates on different paywalls push in any order without pulling, and nobody's work is lost", async () => {
  const { remote, people } = team("nick", "jom", "ana");
  const [nick, jom, ana] = people;
  assert.ok(nick && jom && ana);

  for (let round = 1; round <= 4; round++) {
    const order: [Teammate, string][] = [
      [nick, "a"],
      [jom, "b"],
      [ana, "c"],
    ];
    for (const [who, id] of order) {
      who.write(`paywalls/${id}/index.tsx`, paywall(`${id} round ${round}`));
      who.write(`paywalls/${id}/app/step-${round}.tsx`, paywall(`${id} step ${round}`));
      assert.equal((await who.push(id)).status, "committed");
    }
  }

  const tree = repoTree(remote);
  for (const id of ["a", "b", "c"]) {
    assert.equal(tree.get(`paywalls/${id}/index.tsx`), paywall(`${id} round 4`));
    for (let round = 1; round <= 4; round++) assert.ok(tree.has(`paywalls/${id}/app/step-${round}.tsx`));
  }
  const lock = JSON.parse(tree.get("superwall.lock") ?? "{}");
  assert.deepEqual(Object.keys(lock.paywalls).sort(), ["a", "b", "c"]);

  for (const who of people) await who.pull();
  for (const who of people) {
    assert.deepEqual(sourceFiles(snapshot(who.dir)), sourceFiles(tree), `${who.name} converged on the repo`);
    assert.deepEqual(Object.keys(readLock(who.dir).paywalls).sort(), ["a", "b", "c"]);
  }
  assertNoConflictMarkers("repo", tree);
});

test("two edits to different lines of one shared file merge on push and on pull", async () => {
  const { remote, people } = team("nick", "jom");
  const [nick, jom] = people;
  assert.ok(nick && jom);

  nick.write("components/theme.ts", lines(20)).write("paywalls/a/index.tsx", paywall("a"));
  await nick.push("a");
  await jom.pull();
  assert.equal(jom.read("components/theme.ts"), lines(20));

  jom.write("components/theme.ts", lines(20, { 15: "jom's line" })).write("paywalls/b/index.tsx", paywall("b"));
  await jom.push("b");
  nick.write("components/theme.ts", lines(20, { 2: "nick's line" }));
  await nick.push("a");

  const merged = lines(20, { 2: "nick's line", 15: "jom's line" });
  assert.equal(repoTree(remote).get("components/theme.ts"), merged);

  nick.write("components/theme.ts", lines(20, { 2: "nick's line", 5: "nick again" }));
  await nick.pull();
  assert.equal(nick.read("components/theme.ts"), lines(20, { 2: "nick's line", 5: "nick again", 15: "jom's line" }));
  assert.equal(nick.read("paywalls/b/index.tsx"), paywall("b"));
});

test("the same line edited twice refuses push and pull alike, changes nothing, and --theirs settles it", async () => {
  const { remote, people } = team("nick", "jom");
  const [nick, jom] = people;
  assert.ok(nick && jom);

  nick.write("components/theme.ts", lines(5)).write("paywalls/a/index.tsx", paywall("a"));
  await nick.push("a");
  await jom.pull();
  jom.write("components/theme.ts", lines(5, { 1: "jom" }));
  await jom.push("a");

  nick.write("components/theme.ts", lines(5, { 1: "nick" }));
  const conflict = (error: unknown) =>
    (error instanceof SourceConflictError || error instanceof PullConflictError) &&
    error.files.join() === "components/theme.ts";
  await refusedWithoutChange(nick, () => nick.push("a"), conflict);
  await refusedWithoutChange(nick, () => nick.pull(), conflict);
  await nick.pull({ theirs: true });
  assert.equal(nick.read("components/theme.ts"), lines(5, { 1: "jom" }));
  assertNoConflictMarkers("nick", snapshot(nick.dir));
  assert.equal((await nick.push("a")).status, "unchanged");
  nick.write("components/theme.ts", lines(5, { 1: "jom", 3: "nick, after jom" }));
  assert.equal((await nick.push("a")).status, "committed");
});

test("a teammate's deletion against your edit, and two different new files at one path, are conflicts, never silent picks", async () => {
  const { people } = team("nick", "jom");
  const [nick, jom] = people;
  assert.ok(nick && jom);

  nick.write("paywalls/a/index.tsx", paywall("a")).write("paywalls/a/extra.ts", "extra\n");
  await nick.push("a");
  await jom.pull();
  jom.remove("paywalls/a/extra.ts").write("paywalls/a/new.ts", "jom's new\n");
  await jom.push("a");

  nick.write("paywalls/a/extra.ts", "nick edited extra\n").write("paywalls/a/new.ts", "nick's new\n");
  await assert.rejects(
    nick.pull(),
    (error: unknown) =>
      error instanceof PullConflictError && error.files.join() === "paywalls/a/extra.ts,paywalls/a/new.ts",
  );
  await assert.rejects(nick.push("a"), SourceConflictError);

  await nick.pull({ theirs: true });
  assert.equal(nick.read("paywalls/a/extra.ts"), undefined);
  assert.equal(nick.read("paywalls/a/new.ts"), "jom's new\n");
});

test("after publishing onto a teammate's paywall with no sync point, pull brings that paywall and its later changes in", async () => {
  const { remote, people } = team("nick", "jom");
  const [nick, jom] = people;
  assert.ok(nick && jom);

  jom.write("paywalls/b/index.tsx", paywall("b1")).write("components/button.tsx", "button\n");
  await jom.push("b");

  nick.write("paywalls/a/index.tsx", paywall("a1"));
  assert.equal((await nick.push("a")).status, "committed");
  assert.equal(nick.read("paywalls/b/index.tsx"), undefined);

  await nick.pull();
  assert.equal(nick.read("paywalls/b/index.tsx"), paywall("b1"));
  assert.equal(nick.read("components/button.tsx"), "button\n");

  await jom.pull();
  jom.write("paywalls/b/index.tsx", paywall("b2"));
  await jom.push("b");
  await nick.pull();
  assert.equal(nick.read("paywalls/b/index.tsx"), paywall("b2"));
  assert.equal(nick.read("paywalls/a/index.tsx"), paywall("a1"));
  assert.deepEqual(sourceFiles(snapshot(nick.dir)), sourceFiles(repoTree(remote)));
});

test("a project that never pulled a teammate's paywall still gets it, and its later changes, without a conflict", async () => {
  const { remote, people } = team("nick", "jom");
  const [nick, jom] = people;
  assert.ok(nick && jom);

  nick.write("paywalls/a/index.tsx", paywall("a1"));
  await nick.push("a");
  await jom.pull();
  jom.write("paywalls/b/index.tsx", paywall("b1"));
  await jom.push("b");
  nick.write("paywalls/a/index.tsx", paywall("a2"));
  await nick.push("a");
  jom.write("paywalls/b/index.tsx", paywall("b2"));
  await jom.push("b");

  await nick.pull();
  assert.equal(nick.read("paywalls/b/index.tsx"), paywall("b2"));
  assert.deepEqual(sourceFiles(snapshot(nick.dir)), sourceFiles(repoTree(remote)));
});

test("pushes racing each other both land, each merged on top of the other", async () => {
  const { remote, people } = team("nick", "jom", "ana");
  const [nick, jom, ana] = people;
  assert.ok(nick && jom && ana);

  nick.write("paywalls/a/index.tsx", paywall("a0"));
  await nick.push("a");
  await jom.pull();
  await ana.pull();

  nick.write("paywalls/a/index.tsx", paywall("a1"));
  jom.write("paywalls/b/index.tsx", paywall("b1"));
  ana.write("funnels/c/index.tsx", paywall("c1"));
  const results = await Promise.all([nick.push("a"), jom.push("b"), ana.push("c", { kind: "funnel" })]);
  assert.ok(results.every((result) => result.status === "committed"));

  const tree = repoTree(remote);
  assert.equal(tree.get("paywalls/a/index.tsx"), paywall("a1"));
  assert.equal(tree.get("paywalls/b/index.tsx"), paywall("b1"));
  assert.equal(tree.get("funnels/c/index.tsx"), paywall("c1"));
  const lock = JSON.parse(tree.get("superwall.lock") ?? "{}");
  assert.deepEqual(Object.keys(lock.paywalls).sort(), ["a", "b"]);
  assert.deepEqual(Object.keys(lock.funnels), ["c"]);
});

test("--overwrite-source on a diverged paywall replaces only that paywall, and the teammate can pull it", async () => {
  const { remote, people } = team("nick", "jom");
  const [nick, jom] = people;
  assert.ok(nick && jom);

  jom.write("paywalls/a/index.tsx", paywall("jom a")).write("paywalls/b/index.tsx", paywall("jom b"));
  jom.write("components/button.tsx", "jom button\n");
  await jom.push("a");
  await jom.push("b");

  nick.write("paywalls/a/index.tsx", paywall("nick a")).bind("a");
  await refusedWithoutChange(
    nick,
    () => nick.push("a"),
    (error) => error instanceof SourceDivergedError && error.files.join() === "paywalls/a/index.tsx",
  );
  await nick.push("a", { overwrite: true });

  const tree = repoTree(remote);
  assert.equal(tree.get("paywalls/a/index.tsx"), paywall("nick a"));
  assert.equal(tree.get("paywalls/b/index.tsx"), paywall("jom b"));
  assert.equal(tree.get("components/button.tsx"), "jom button\n");

  await jom.pull({ theirs: true });
  assert.equal(jom.read("paywalls/a/index.tsx"), paywall("nick a"));
  assert.equal(jom.read("paywalls/b/index.tsx"), paywall("jom b"));
});

test("binary files, odd names and line endings survive push and pull byte for byte", async () => {
  const { people } = team("nick", "jom");
  const [nick, jom] = people;
  assert.ok(nick && jom);

  const image = Buffer.from(Array.from({ length: 4096 }, (_, index) => (index * 37) % 256));
  nick.write("paywalls/a/index.tsx", paywall("a"));
  nick.write("paywalls/a/assets/hero image.png", image);
  nick.write("paywalls/a/strings/café – ünïcode.json", '{ "title": "Grüße 👋" }\n');
  nick.write("paywalls/a/windows.txt", "one\r\ntwo\r\n");
  nick.write("paywalls/a/empty.txt", "");
  await nick.push("a");

  await jom.pull();
  assert.deepEqual(fs.readFileSync(path.join(jom.dir, "paywalls/a/assets/hero image.png")), image);
  assert.equal(jom.read("paywalls/a/strings/café – ünïcode.json"), '{ "title": "Grüße 👋" }\n');
  assert.equal(jom.read("paywalls/a/windows.txt"), "one\r\ntwo\r\n");
  assert.equal(jom.read("paywalls/a/empty.txt"), "");
});

test("a binary both sides changed is a conflict, never a corrupted merge", async () => {
  const { people } = team("nick", "jom");
  const [nick, jom] = people;
  assert.ok(nick && jom);

  nick.write("paywalls/a/index.tsx", paywall("a")).write("paywalls/a/hero.png", Buffer.from([0, 1, 2, 3, 0, 255]));
  await nick.push("a");
  await jom.pull();
  jom.write("paywalls/a/hero.png", Buffer.from([0, 9, 9, 9, 0, 255]));
  await jom.push("a");

  nick.write("paywalls/a/hero.png", Buffer.from([0, 7, 7, 7, 0, 255]));
  await assert.rejects(nick.pull(), (error: unknown) => error instanceof PullConflictError && error.files.join() === "paywalls/a/hero.png");
  await nick.pull({ theirs: true });
  assert.deepEqual(fs.readFileSync(path.join(nick.dir, "paywalls/a/hero.png")), Buffer.from([0, 9, 9, 9, 0, 255]));
});

test("a paywall and a funnel with the same id are separate surfaces", async () => {
  const { remote, people } = team("nick", "jom");
  const [nick, jom] = people;
  assert.ok(nick && jom);

  nick.write("paywalls/a/index.tsx", paywall("paywall a"));
  await nick.push("a");
  jom.write("funnels/a/index.tsx", paywall("funnel a"));
  await jom.push("a", { kind: "funnel" });

  const tree = repoTree(remote);
  assert.equal(tree.get("paywalls/a/index.tsx"), paywall("paywall a"));
  assert.equal(tree.get("funnels/a/index.tsx"), paywall("funnel a"));
  const lock = JSON.parse(tree.get("superwall.lock") ?? "{}");
  assert.ok(lock.paywalls.a && lock.funnels.a);
});

test("pull keeps your pending version and your own bindings, and adds the teammate's", async () => {
  const { people } = team("nick", "jom");
  const [nick, jom] = people;
  assert.ok(nick && jom);

  nick.write("paywalls/a/index.tsx", paywall("a"));
  await nick.push("a");
  await jom.pull();
  jom.write("paywalls/b/index.tsx", paywall("b"));
  await jom.push("b");

  nick.bind("a", "paywall", 9);
  const pending = readLock(nick.dir).paywalls.a?.ios;
  await nick.pull();
  const lock = readLock(nick.dir);
  assert.deepEqual(lock.paywalls.a?.ios, pending);
  assert.equal(lock.paywalls.a?.ios?.sourcePending, 9);
  assert.deepEqual(lock.paywalls.b, readLock(jom.dir).paywalls.b);
});

test("pulling twice is a no-op the second time, and pushing straight after a pull changes nothing", async () => {
  const { remote, people } = team("nick", "jom");
  const [nick, jom] = people;
  assert.ok(nick && jom);

  nick.write("paywalls/a/index.tsx", paywall("a"));
  await nick.push("a");
  jom.write("paywalls/b/index.tsx", paywall("b"));
  await jom.push("b");

  await nick.pull();
  const after = snapshot(nick.dir);
  const base = nick.base();
  assert.deepEqual((await nick.pull())?.written, []);
  assert.deepEqual(snapshot(nick.dir), after);
  assert.equal(nick.base(), base);
  assert.equal(base, headOf(remote));
});

const SEEDS = (process.env.SUPERWALL_COLLAB_SEEDS ?? "7,1234,90210").split(",").map(Number);

for (const start of SEEDS) test(`a long random session of three teammates (seed ${start}) never loses a push, never writes a marker, and converges`, async () => {
  const { remote, people } = team("nick", "jom", "ana");
  let seed = start;
  const random = (below: number) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % below;
  };
  const owned = new Map(people.map((who, index) => [who, ["a", "b", "c"][index] ?? "x"]));
  const lastPushed = new Map<string, string>();
  const steps: string[] = [];

  for (let step = 0; step < 60; step++) {
    const who = people[random(people.length)];
    assert.ok(who);
    const id = owned.get(who) ?? "x";
    const action = random(5);
    steps.push(`${who.name}:${action}`);
    if (action <= 1) {
      who.write(`paywalls/${id}/index.tsx`, paywall(`${id} step ${step}`));
      who.write(`components/${who.name}.ts`, `export const by = "${who.name} ${step}";\n`);
      if (random(3) === 0) who.write(`paywalls/${id}/app/s${step}.tsx`, paywall(`extra ${step}`));
    } else if (action <= 3) {
      try {
        const pushed = await who.push(id);
        if (pushed.status === "committed") lastPushed.set(id, who.read(`paywalls/${id}/index.tsx`) ?? "");
      } catch (error) {
        assert.ok(error instanceof SourceConflictError || error instanceof SourceDivergedError, `${steps.join(" ")}: ${String(error)}`);
        await who.pull({ theirs: true });
      }
    } else {
      try {
        await who.pull();
      } catch (error) {
        assert.ok(error instanceof PullConflictError, `${steps.join(" ")}: ${String(error)}`);
        await who.pull({ theirs: true });
      }
    }
    assertNoConflictMarkers(`repo after ${steps.join(" ")}`, repoTree(remote));
    for (const person of people) assertNoConflictMarkers(`${person.name} after ${steps.join(" ")}`, snapshot(person.dir));
  }

  const tree = repoTree(remote);
  for (const [id, content] of lastPushed) {
    assert.equal(tree.get(`paywalls/${id}/index.tsx`), content, `${id}'s last push survived: ${steps.join(" ")}`);
  }
  for (const who of people) {
    const id = owned.get(who) ?? "x";
    await who.push(id).catch(async (error: unknown) => {
      assert.ok(error instanceof SourceConflictError || error instanceof SourceDivergedError);
      await who.pull({ theirs: true });
      await who.push(id);
    });
  }
  for (const who of people) {
    await who.pull();
    assert.deepEqual((await who.pull())?.written, [], `${who.name}'s second pull changes nothing`);
  }
  const final = sourceFiles(repoTree(remote));
  for (const who of people) {
    const mine = sourceFiles(snapshot(who.dir));
    for (const [file, content] of final) assert.equal(mine.get(file), content, `${who.name} has ${file}`);
  }
});
