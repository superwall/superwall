import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { FRAMEWORK_REF } from "@/core/workflows/agent/actions";
import { Integration, VERSION } from "@/environment";
import { SKILLS_INSTALL_SOURCE, SKILLS_REF, checkSkillsSync, ensureSkillsCurrent, knownSkills, readBundledSkill, normalizeSkillFrontmatter, normalizeSkillsDir, PLAYBOOKS, bundledSkills } from "@/core/support/skills";
import { command as skillsCommand } from "@/commands/support/skills";
import { readSkillsSync, writeSkillsSync } from "@/core/state/config";
import { useRenderer } from "@/ui";
import { plainRenderer } from "@/ui/plain/renderer";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fg from "fast-glob";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { restoreBin, useBin } from "../../helpers/bin";
import { runCommand } from "../../helpers/command";
import { restoreFetch, useFetch } from "../../helpers/fetch";
import { clearHomes, useHome } from "../../helpers/home";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";

test("review uses the broad setup skill rather than the placement skill", () => {
  const body = readBundledSkill("superwall-review", "ios");

  assert.match(body, /Review the integration as a system, not as a placement inventory/);
  assert.match(body, /Purchases & subscriptions/);
  assert.match(body, /Deep links and Web Checkout/);
  assert.match(body, /Analytics events becoming placements is recommended/);
  assert.doesNotMatch(body, /Review Superwall - Expo/);
});

test("review composes exactly one framework reference", () => {
  const cases = [
    ["ios", "iOS / Swift"],
    ["android", "Android / Kotlin"],
    ["expo", "Expo"],
    ["react-native", "React Native"],
    ["flutter", "Flutter"],
  ] as const;

  for (const [reference, heading] of cases) {
    const body = readBundledSkill("superwall-review", reference);
    assert.match(body, new RegExp(`# Review Superwall - ${heading}`));
    for (const [, other] of cases) {
      if (other !== heading) assert.doesNotMatch(body, new RegExp(`# Review Superwall - ${other}`));
    }
  }
});

test("skills sync: stale on missing/changed CLI version, fresh within a day, verify after", () => {
  const now = Date.parse("2026-07-15T00:00:00Z");
  const day = 24 * 60 * 60 * 1000;
  const at = (ms: number) => new Date(ms).toISOString();

  assert.equal(checkSkillsSync(undefined, "1.0.0", "main", now), "stale");
  const fresh = { cliVersion: "1.0.0", syncedAt: at(now - 60_000), sourceSha: "abc", ref: "main" };
  assert.equal(checkSkillsSync(fresh, "1.0.0", "main", now), "fresh");
  assert.equal(checkSkillsSync(fresh, "1.1.0", "main", now), "stale");
  assert.equal(checkSkillsSync(fresh, "1.0.0", "next", now), "stale");
  assert.equal(
    checkSkillsSync({ cliVersion: "1.0.0", syncedAt: at(now - 2 * day), ref: "main" }, "1.0.0", "main", now),
    "verify",
  );
  assert.equal(
    checkSkillsSync({ cliVersion: "1.0.0", syncedAt: "garbage", ref: "main" }, "1.0.0", "main", now),
    "stale",
  );
});

test("the skills source follows the channel", () => {
  const original = process.env.SUPERWALL_CHANNEL;
  try {
    delete process.env.SUPERWALL_CHANNEL;
    assert.equal(SKILLS_REF(), "main");
    assert.equal(SKILLS_INSTALL_SOURCE(), "superwall/skills");
    assert.deepEqual(
      knownSkills().map((s) => s.name).filter((n) => /framework|paywall-migrate|screen-migrate/.test(n)),
      [],
    );
    process.env.SUPERWALL_CHANNEL = "nightly";
    assert.equal(SKILLS_REF(), "main");
    process.env.SUPERWALL_CHANNEL = "next";
    assert.equal(SKILLS_REF(), "next");
    assert.equal(SKILLS_INSTALL_SOURCE(), "https://github.com/superwall/skills/tree/next");
    assert.ok(knownSkills().some((s) => s.name === "superwall-framework"));
  } finally {
    process.env.SUPERWALL_CHANNEL = original;
  }
});

test("missing bundled references fail closed", () => {
  assert.throws(
    () => readBundledSkill("superwall-review", "missing-framework"),
    /Bundled skill asset is missing: superwall\/workflows\/review\/missing-framework\.md/,
  );
});

test("integrate, placements and screen migration carry an Android reference", () => {
  assert.match(readBundledSkill("superwall-integrate", "android"), /# Integrate Superwall - Android \/ Kotlin/);
  assert.match(readBundledSkill("superwall-placements", ["strategy", "android"]), /# Superwall placements - Android \/ Kotlin/);
  assert.match(readBundledSkill("superwall-screen-migrate", "android"), /# Android source screens/);
  assert.equal(FRAMEWORK_REF[Integration.android], "android");
});

const field = (md: string, key: string) => {
  const raw = md.split("\n").find((line) => line.startsWith(`${key}: `))!.slice(key.length + 2);
  assert.ok(raw.startsWith('"'), `${key} should be quoted: ${raw}`);
  return JSON.parse(raw) as string;
};

test("frontmatter strict YAML rejects is quoted, and keeps its text", () => {
  const description =
    "Animate a tap-through onboarding (quiz, survey, web2app flow) so the motion tells the story: each hand-off gets its own choreography";
  const md = `---\nname: animate-onboarding\ndescription: ${description}\nuser-invocable: true\n---\n\n# Body: untouched\n`;
  const normalized = normalizeSkillFrontmatter(md);
  assert.equal(field(normalized, "description"), description);
  assert.match(normalized, /^---\nname: animate-onboarding\n/);
  assert.match(normalized, /\nuser-invocable: true\n---\n/);
  assert.ok(normalized.endsWith("\n# Body: untouched\n"));
});

test("valid frontmatter and bodies are left exactly as they are", () => {
  const cases = [
    `---\nname: wwdc\ndescription: "Use this: quoted already"\n---\nbody`,
    `---\nname: a\ndescription: plain text, no colon space\n---\nbody`,
    `---\nname: a\ndescription: |\n  block: text\n---\nbody`,
    `# no frontmatter: at all`,
  ];
  for (const md of cases) assert.equal(normalizeSkillFrontmatter(md), md);
});

test("values with a comment marker or a reserved first character are quoted", () => {
  for (const value of ["uses # inside", "`code` first", "@scoped first", "ends with a colon:"]) {
    const normalized = normalizeSkillFrontmatter(`---\ndescription: ${value}\n---\n`);
    assert.equal(field(normalized, "description"), value);
  }
});

test("a checkout's skills are normalised in place", () => {
  const root = mkdtempSync(join(tmpdir(), "skills-test-"));
  try {
    mkdirSync(join(root, "broken"));
    mkdirSync(join(root, "fine"));
    mkdirSync(join(root, "no-skill"));
    writeFileSync(join(root, "broken", "SKILL.md"), "---\nname: broken\ndescription: one: two\n---\n");
    writeFileSync(join(root, "fine", "SKILL.md"), "---\nname: fine\ndescription: fine\n---\n");
    writeFileSync(join(root, "README.md"), "not a skill");
    normalizeSkillsDir(root);
    assert.equal(field(readFileSync(join(root, "broken", "SKILL.md"), "utf8"), "description"), "one: two");
    assert.equal(readFileSync(join(root, "fine", "SKILL.md"), "utf8"), "---\nname: fine\ndescription: fine\n---\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("bundled agent guidance treats JSON as the machine contract", () => {
  const files = ["prompts/commandments.xml", ...fg.sync("dist/skills/**/*.md")];
  const contents = files.map((file) => [file, readFileSync(file, "utf8")] as const);

  for (const [file, content] of contents) assert.doesNotMatch(content, /pk_PLACEHOLDER/, file);

  const commandments = readFileSync("prompts/commandments.xml", "utf8");
  assert.match(commandments, /pass --json for every data or mutation command/);
});

test("every bundled campaign creation supplies a placement and requests JSON", () => {
  for (const file of fg.sync("dist/skills/**/*.md")) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(/superwall campaigns create ([^\n`]+)/g)) {
      const command = match[0].replace(/\\\s*$/, "");
      assert.match(command, /create\s+(?:"[^"]+"|'[^']+'|\S+)\s+\S+/, `${file}: ${command}`);
      assert.match(command, /--json\b/, `${file}: ${command}`);
    }
  }
});

test("every skill of the repo is bundled, with its channel, and nothing else", () => {
  const dirs = fg.sync("dist/skills/*/SKILL.md").map((file) => file.split("/")[2]!).sort();
  const index = bundledSkills();
  assert.deepEqual(index.map((skill) => skill.name).sort(), dirs);
  assert.equal(index.find((skill) => skill.name === "superwall")?.channel, "latest");
  assert.equal(index.find((skill) => skill.name === "superwall-framework")?.channel, "next");
  for (const { name, summary } of index) {
    assert.match(readFileSync(`dist/skills/${name}/SKILL.md`, "utf8"), new RegExp(`^name: ${name}$`, "m"));
    assert.ok(summary.length > 0 && summary.length <= 64, `${name}: summary`);
  }
  for (const [id, { playbook, refs }] of Object.entries(PLAYBOOKS)) {
    assert.ok(readFileSync(`dist/skills/${playbook}`, "utf8").length > 0, id);
    assert.ok(fg.sync(`dist/skills/${refs}/*.md`).length > 0, id);
  }
});

const original = process.env.SUPERWALL_AGENT_SKILLS_DIR;

afterEach(() => {
  process.env.SUPERWALL_AGENT_SKILLS_DIR = original;
});

test("the installed live copy of a skill wins over the bundle, per playbook", () => {
  const bundled = readBundledSkill("superwall-dashboard", "setup");
  const live = fs.mkdtempSync(path.join(os.tmpdir(), "sw-live-skills-"));
  fs.mkdirSync(path.join(live, "superwall", "workflows", "dashboard"), { recursive: true });
  fs.writeFileSync(path.join(live, "superwall", "workflows", "dashboard", "playbook.md"), "---\nname: superwall\n---\n# LIVE dashboard playbook\n");
  fs.writeFileSync(path.join(live, "superwall", "workflows", "dashboard", "setup.md"), "# LIVE setup\n");
  process.env.SUPERWALL_AGENT_SKILLS_DIR = live;
  const composed = readBundledSkill("superwall-dashboard", "setup");
  assert.match(composed, /^# LIVE dashboard playbook\n\n# LIVE setup$/);
  assert.notEqual(composed, bundled);
  assert.match(readBundledSkill("superwall-review", "ios"), /# Review Superwall - iOS/);
  fs.rmSync(live, { recursive: true, force: true });
});

const GITHUB_CONTENTS = "api.github.com/repos/superwall/skills/contents/skills?ref=next";
const GITHUB_HEAD = "api.github.com/repos/superwall/skills/commits/next";
const RAW_SKILL = (name: string) => `raw.githubusercontent.com/superwall/skills/next/skills/${name}/SKILL.md`;

function fakeTools({ npxCode = 0, cloneSkills = true, git = true }: { npxCode?: number; cloneSkills?: boolean; git?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sw-skills-tools-"));
  scratch.push(dir);
  const calls = join(dir, "npx-calls");
  const seen = join(dir, "seen-skill");
  const bins: Record<string, string> = {
    npx: [
      `printf '%s\\0' "$@" >> "${calls}"`,
      `printf '\\n' >> "${calls}"`,
      `if [ -f "$4/broken/SKILL.md" ]; then /bin/cat "$4/broken/SKILL.md" > "${seen}"; fi`,
      'echo "Installing"; echo "npm warn" >&2',
      `exit ${npxCode}`,
    ].join("\n"),
  };
  if (git) {
    bins.git = [
      'for a in "$@"; do target="$a"; done',
      `printf '%s' "$target" > "${dir}/clone-target"`,
      'echo "Cloning into $target"',
      cloneSkills ? '/bin/mkdir -p "$target/skills/broken"' : "",
      cloneSkills ? `printf -- '---\\nname: broken\\ndescription: one: two\\n---\\n' > "$target/skills/broken/SKILL.md"` : "",
    ].join("\n");
  }
  process.env.PATH = useBin(bins);
  return {
    npxCalls: () =>
      existsSync(calls)
        ? readFileSync(calls, "utf8").split("\n").filter(Boolean).map((line) => line.split("\0").filter(Boolean))
        : [],
    seenSkill: () => (existsSync(seen) ? readFileSync(seen, "utf8") : undefined),
    cloneTarget: () => readFileSync(join(dir, "clone-target"), "utf8"),
  };
}

function recordSpinner(): RendererCall[] {
  const calls: RendererCall[] = [];
  useRenderer(recordingRenderer(calls));
  return calls;
}

const said = (calls: RendererCall[], method: string) =>
  calls.filter((call) => call.method === method).map((call) => String(call.value));

const scratch: string[] = [];

afterEach(() => {
  restoreFetch();
  restoreBin();
  clearHomes();
  useRenderer(plainRenderer);
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
  process.exitCode = 0;
});

test("a playbook whose frontmatter never closes is read whole", () => {
  const live = mkdtempSync(join(tmpdir(), "sw-live-skills-"));
  scratch.push(live);
  mkdirSync(join(live, "superwall", "workflows", "integrate"), { recursive: true });
  writeFileSync(join(live, "superwall", "workflows", "integrate", "playbook.md"), "---\nname: superwall\n# Unclosed\n");
  process.env.SUPERWALL_AGENT_SKILLS_DIR = live;

  assert.equal(readBundledSkill("superwall-integrate"), "---\nname: superwall\n# Unclosed");
});

test("frontmatter that never closes is left alone", () => {
  const md = "---\nname: a\ndescription: one: two\n";
  assert.equal(normalizeSkillFrontmatter(md), md);
});

test("current skills are left alone", async () => {
  useHome();
  writeSkillsSync({ cliVersion: VERSION, syncedAt: new Date().toISOString(), ref: "next", sourceSha: "abc" });
  const tools = fakeTools();
  const calls = recordSpinner();

  await ensureSkillsCurrent();

  assert.deepEqual(tools.npxCalls(), []);
  assert.deepEqual(calls, []);
});

test("stale skills are reinstalled from a normalised clone and the sync is recorded", async () => {
  useHome();
  const log = useFetch([{ match: GITHUB_HEAD, body: { sha: "head-sha" } }]);
  const tools = fakeTools();
  const calls = recordSpinner();

  await ensureSkillsCurrent(false, "login");

  const [bundled, pub] = tools.npxCalls();
  assert.ok(bundled?.includes("--copy"));
  const names = bundledSkills().map((skill) => skill.name);
  assert.deepEqual(bundled?.slice(-(names.length + 2)), ["--skill", ...names, "--copy"]);
  assert.equal(pub?.[3], join(tools.cloneTarget(), "skills"));
  assert.deepEqual(pub?.slice(-4), ["--yes", "--skill", "*", "--copy"]);
  assert.equal(tools.seenSkill(), '---\nname: broken\ndescription: "one: two"\n---\n');
  assert.equal(existsSync(tools.cloneTarget()), false);
  assert.deepEqual(said(calls, "spinner.start"), ["Updating Superwall skills"]);
  assert.deepEqual(said(calls, "spinner.stop"), ["Superwall skills up to date"]);
  const sync = readSkillsSync();
  assert.equal(sync?.cliVersion, VERSION);
  assert.equal(sync?.sourceSha, "head-sha");
  assert.equal(sync?.ref, "next");
  assert.ok(log.some((entry) => entry.url.includes(GITHUB_HEAD)));
});

test("a required install says it installed, and records no sha when GitHub cannot be reached", async () => {
  useHome();
  useFetch([{ match: GITHUB_HEAD, fail: true }]);
  fakeTools({ git: false });
  const calls = recordSpinner();

  await ensureSkillsCurrent(true);

  assert.deepEqual(said(calls, "spinner.start"), ["Installing Superwall skills for your agent"]);
  assert.deepEqual(said(calls, "spinner.stop"), ["Superwall skills installed"]);
  assert.equal(readSkillsSync()?.sourceSha, undefined);
});

test("a clone without a skills directory falls back to installing from GitHub", async () => {
  useHome();
  useFetch([{ match: GITHUB_HEAD, body: {} }]);
  const tools = fakeTools({ cloneSkills: false });
  recordSpinner();

  await ensureSkillsCurrent(true);

  assert.equal(tools.npxCalls()[1]?.[3], "https://github.com/superwall/skills/tree/next");
  assert.equal(existsSync(tools.cloneTarget()), false);
});

test("a required install that fails is an error, and an optional one is skipped quietly", async () => {
  useHome();
  fakeTools({ npxCode: 1, git: false });
  const calls = recordSpinner();

  await assert.rejects(
    ensureSkillsCurrent(true),
    /The integration completed, but the Superwall skills could not be installed\./,
  );
  await ensureSkillsCurrent(false);

  assert.deepEqual(said(calls, "spinner.stop"), ["Skill install skipped", "Skill install skipped"]);
  assert.equal(readSkillsSync(), undefined);
});

test("day-old skills are checked against the repo head, and refreshed only when it moved", async () => {
  const old = { cliVersion: VERSION, syncedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), ref: "next", sourceSha: "abc" };
  useHome();
  const tools = fakeTools({ git: false });
  recordSpinner();

  writeSkillsSync(old);
  useFetch([{ match: GITHUB_HEAD, body: { sha: "abc" } }]);
  await ensureSkillsCurrent();
  assert.deepEqual(tools.npxCalls(), []);
  assert.ok(Date.parse(readSkillsSync()?.syncedAt ?? "") > Date.parse(old.syncedAt));

  writeSkillsSync(old);
  useFetch([{ match: GITHUB_HEAD, status: 500, body: {} }]);
  await ensureSkillsCurrent();
  assert.deepEqual(tools.npxCalls(), []);
  assert.equal(readSkillsSync()?.syncedAt, old.syncedAt);

  writeSkillsSync(old);
  useFetch([{ match: GITHUB_HEAD, body: { sha: "moved" } }]);
  await ensureSkillsCurrent();
  assert.equal(tools.npxCalls().length, 2);
  assert.equal(readSkillsSync()?.sourceSha, "moved");
});

function pickingRenderer(calls: RendererCall[], pick: (values: string[]) => string[] | null) {
  return {
    ...recordingRenderer(calls),
    multiselect: async (value: unknown) => {
      calls.push({ method: "multiselect", value });
      const { options } = value as { options: { value: string }[] };
      return pick(options.map((option) => option.value));
    },
  };
}

test("the picker lists the repo's skills, superwall first, each with its first sentence", async () => {
  useHome();
  useFetch([
    { match: GITHUB_HEAD, body: { sha: "abc" } },
    {
      match: GITHUB_CONTENTS,
      body: [
        { name: "zeta", type: "dir" },
        { name: "superwall", type: "dir" },
        { name: "alpha", type: "dir" },
        { name: "beta", type: "dir" },
        { name: "gamma", type: "dir" },
        { name: "README.md", type: "file" },
      ],
    },
    { match: RAW_SKILL("superwall"), text: '---\ndescription: "Use the CLI. It does a lot."\n---\n' },
    { match: RAW_SKILL("zeta"), text: `---\ndescription: ${"word ".repeat(20)}\n---\n` },
    { match: RAW_SKILL("alpha"), status: 404, text: "missing" },
    { match: RAW_SKILL("beta"), fail: true },
    { match: RAW_SKILL("gamma"), text: "# No frontmatter\n" },
  ]);
  const tools = fakeTools({ git: false });
  const calls: RendererCall[] = [];

  await runCommand(skillsCommand, { flags: { force: true }, interactive: true, renderer: pickingRenderer(calls, (all) => all) });

  const offered = (calls.find((call) => call.method === "multiselect")?.value as {
    options: { value: string; hint: string }[];
  }).options;
  assert.deepEqual(
    offered.map((option) => [option.value, option.hint]),
    [
      ["superwall", "Use the CLI."],
      ["alpha", ""],
      ["beta", ""],
      ["gamma", ""],
      ["zeta", `${"word ".repeat(12)}w...`],
    ],
  );
  assert.deepEqual(tools.npxCalls()[1]?.slice(-2), ["--skill", "*"]);
});

test("the picker falls back to the skills it knows when the repo cannot be listed", async () => {
  useHome();
  for (const route of [
    { match: GITHUB_CONTENTS, status: 500, body: {} },
    { match: GITHUB_CONTENTS, body: [{ name: "README.md", type: "file" }] },
    { match: GITHUB_CONTENTS, fail: true },
  ]) {
    useFetch([route]);
    const calls: RendererCall[] = [];

    await runCommand(skillsCommand, { flags: { force: true }, interactive: true, renderer: pickingRenderer(calls, () => null) });

    const offered = (calls.find((call) => call.method === "multiselect")?.value as { options: { value: string }[] }).options;
    assert.deepEqual(
      offered.map((option) => option.value),
      knownSkills().map((skill) => skill.name),
    );
    assert.deepEqual(said(calls, "warn"), ["Nothing selected."]);
  }
});
