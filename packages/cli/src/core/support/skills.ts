import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandContext } from "@/program/command";
import { readSkillsSync, writeSkillsSync, type SkillsSync } from "@/core/state/config";
import { track } from "@/core/support/telemetry";
import { CHANNEL, CHANNELS, VERSION, type Channel } from "@/environment";
import { AGENT_SKILLS_DIR } from "@/hosts/paths";
import { packagedDir } from "@/hosts/paths";
import { ui } from "@/ui";
import { withSpinner } from "@/ui/spinner";
import { spawnStream } from "../workflows/agent/drivers/spawn";

export const SUPERWALL_SKILLS_SOURCE = "superwall/skills";

export const skillsRefFor = (channel: Channel): string => CHANNELS[channel].skillsRef;

export const SKILLS_REF = (): string => skillsRefFor(CHANNEL());

const skillsInstallSourceFor = (channel: Channel): string =>
  channel === "latest"
    ? SUPERWALL_SKILLS_SOURCE
    : `https://github.com/${SUPERWALL_SKILLS_SOURCE}/tree/${skillsRefFor(channel)}`;

export const SKILLS_INSTALL_SOURCE = (): string => skillsInstallSourceFor(CHANNEL());

export const VENDORED_SKILLS: Record<string, Channel> = {
  superwall: "latest",
  "superwall-framework": "next",
};

const onChannel = (channel: Channel): boolean => channel === "latest" || channel === CHANNEL();

const bundledSkillsForChannel = (): string[] =>
  Object.entries(VENDORED_SKILLS)
    .filter(([, channel]) => onChannel(channel))
    .map(([name]) => name);

export type BundledSkillId =
  | "superwall-integrate"
  | "superwall-placements"
  | "superwall-dashboard"
  | "superwall-review"
  | "superwall-migrate"
  | "superwall-paywall-migrate"
  | "superwall-screen-migrate";

export const PLAYBOOKS: Record<BundledSkillId, { playbook: string; refs: string }> = {
  "superwall-integrate": { playbook: "superwall/workflows/integrate/playbook.md", refs: "superwall/workflows/integrate" },
  "superwall-placements": { playbook: "superwall/workflows/placements/playbook.md", refs: "superwall/workflows/placements" },
  "superwall-dashboard": { playbook: "superwall/workflows/dashboard/playbook.md", refs: "superwall/workflows/dashboard" },
  "superwall-review": { playbook: "superwall/workflows/review/playbook.md", refs: "superwall/workflows/review" },
  "superwall-migrate": { playbook: "superwall/workflows/migrate/playbook.md", refs: "superwall/workflows/migrate" },
  "superwall-paywall-migrate": { playbook: "superwall-framework/references/migrate-from-editor.md", refs: "superwall-framework/references" },
  "superwall-screen-migrate": { playbook: "superwall-framework/references/migrate-from-native.md", refs: "superwall-framework/references/native" },
};

const cache = new Map<string, string>();

function bundledSkillsDir(): string {
  return packagedDir("skills").replace(/\/$/, "");
}

export function readBundledSkill(
  id: BundledSkillId,
  reference?: string | Array<string | undefined>,
): string {
  const refs = (Array.isArray(reference) ? reference : [reference]).filter((r): r is string => !!r);
  const { playbook, refs: refsDir } = PLAYBOOKS[id];
  const base = resolveSkillsBase(playbook);
  const key = `${base}:${refs.length ? `${id}#${refs.join("+")}` : id}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const skill = readSkillFile(base, playbook);
  const bodies = refs.map((r) => readSkillFile(base, `${refsDir}/${r}.md`));
  const body = [skill, ...bodies].filter(Boolean).join("\n\n");
  cache.set(key, body);
  return body;
}

function resolveSkillsBase(playbook: string): string {
  const installed = `${AGENT_SKILLS_DIR()}/`;
  return existsSync(`${installed}${playbook}`) ? installed : packagedDir("skills");
}

function readSkillFile(base: string, rel: string): string {
  try {
    return stripFrontmatter(readFileSync(`${base}${rel}`, "utf8")).trim();
  } catch (error) {
    throw new Error(`Bundled skill asset is missing: ${rel}`, { cause: error });
  }
}

function stripFrontmatter(md: string): string {
  const lines = md.split("\n");
  if (lines[0]?.trim() === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) return lines.slice(end + 1).join("\n");
  }
  return md;
}

interface SkillInfo {
  name: string;
  summary: string;
}

const KNOWN_SKILLS: Array<SkillInfo & { channel: Channel }> = [
  {
    name: "superwall",
    summary: "Resources, ClickHouse SQL analytics, docs, SDK triage, and dashboard links",
    channel: "latest",
  },
  {
    name: "superwall-editor",
    summary: "Build and edit live paywalls, onboarding, and web2app flows from the CLI",
    channel: "latest",
  },
  {
    name: "superwall-framework",
    summary: "Paywalls, funnels and any updatable screen as React mini-apps with the framework",
    channel: "next",
  },
  { name: "superwall-integrate", summary: "Install and configure the SDK in an app for the first time", channel: "latest" },
  { name: "superwall-placements", summary: "Add or audit placements at feature gates and route them to campaigns", channel: "latest" },
  { name: "superwall-dashboard", summary: "Create the entitlements, products and campaigns a placement needs", channel: "latest" },
  { name: "superwall-review", summary: "Audit an existing Superwall setup end to end", channel: "latest" },
  { name: "superwall-migrate", summary: "Move an app off RevenueCat, Adapty or Qonversion", channel: "latest" },
  { name: "superwall-paywall-migrate", summary: "Rebuild a dashboard paywall as a framework paywall", channel: "next" },
  { name: "superwall-screen-migrate", summary: "Rebuild a native screen as a framework surface", channel: "next" },
];

export const knownSkills = (): SkillInfo[] =>
  KNOWN_SKILLS.filter((skill) => onChannel(skill.channel)).map(({ name, summary }) => ({ name, summary }));

async function listPublicSkills(): Promise<SkillInfo[]> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${SUPERWALL_SKILLS_SOURCE}/contents/skills?ref=${SKILLS_REF()}`,
      {
        headers: { accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(6000),
      },
    );
    if (!res.ok) return knownSkills();
    const entries = (await res.json()) as Array<{ name: string; type: string }>;
    const dirs = entries.filter((e) => e.type === "dir").map((e) => e.name);
    if (dirs.length === 0) return knownSkills();
    const skills = await Promise.all(
      dirs.map(
        async (name): Promise<SkillInfo> => ({
          name,
          summary: await resolveSkillSummary(name),
        }),
      ),
    );
    return skills.sort((a, b) =>
      a.name === "superwall" ? -1 : b.name === "superwall" ? 1 : a.name.localeCompare(b.name),
    );
  } catch {
    return knownSkills();
  }
}

async function resolveSkillSummary(name: string): Promise<string> {
  try {
    const res = await fetch(
      `https://raw.githubusercontent.com/${SUPERWALL_SKILLS_SOURCE}/${SKILLS_REF()}/skills/${name}/SKILL.md`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) return "";
    const raw = (await res.text()).match(/^description:\s*(.+)$/m)?.[1] ?? "";
    const description = raw.trim().replace(/^["']|["'`]+$/g, "");
    const firstSentence = description.replace(/(?<=\.)\s[\s\S]*$/, "");
    return firstSentence.length > 64 ? `${firstSentence.slice(0, 61)}...` : firstSentence;
  } catch {
    return "";
  }
}

interface InstallSkillsOptions {
  skills?: string[];
  dryRun?: boolean;
}

interface InstallSkillsResult {
  ok: boolean;
  command: string;
}

async function installPublicSkills(
  opts: InstallSkillsOptions = {},
): Promise<InstallSkillsResult> {
  const selection = opts.skills?.length ? ["--skill", ...opts.skills] : ["--skill", "*"];
  const remote = ["-y", "skills@latest", "add", SKILLS_INSTALL_SOURCE(), "--global", "--yes", ...selection];
  if (opts.dryRun) return runInstall(remote, opts);
  const checkout = await clonePublicSkills();
  if (!checkout) return runInstall(remote, opts);
  try {
    normalizeSkillsDir(join(checkout, "skills"));
    return await runInstall(
      ["-y", "skills@latest", "add", join(checkout, "skills"), "--global", "--yes", ...selection, "--copy"],
      opts,
    );
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
}

async function clonePublicSkills(): Promise<string | null> {
  const dir = mkdtempSync(join(tmpdir(), "superwall-skills-"));
  const { code } = await spawnStream({
    bin: "git",
    args: [
      "clone",
      "--quiet",
      "--depth",
      "1",
      "--branch",
      SKILLS_REF(),
      `https://github.com/${SUPERWALL_SKILLS_SOURCE}.git`,
      dir,
    ],
    cwd: process.cwd(),
    onStdoutLine: () => {},
  }).catch(() => ({ code: 1 }));
  if (code === 0 && existsSync(join(dir, "skills"))) return dir;
  rmSync(dir, { recursive: true, force: true });
  return null;
}

export function normalizeSkillsDir(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(dir, entry.name, "SKILL.md");
    if (!existsSync(file)) continue;
    const md = readFileSync(file, "utf8");
    const normalized = normalizeSkillFrontmatter(md);
    if (normalized !== md) writeFileSync(file, normalized);
  }
}

export function normalizeSkillFrontmatter(md: string): string {
  const lines = md.split("\n");
  if (lines[0]?.trim() !== "---") return md;
  const end = lines.indexOf("---", 1);
  if (end < 0) return md;
  for (let i = 1; i < end; i++) {
    const match = lines[i]?.match(/^([A-Za-z0-9_-]+):[ \t]+(.+?)\s*$/);
    const key = match?.[1];
    const value = match?.[2];
    if (key === undefined || value === undefined) continue;
    if (/^["']/.test(value) || /^[|>][+-]?\d*$/.test(value)) continue;
    if (/: |\s#/.test(value) || /^[`@%&*!?{}[\],]/.test(value) || value.endsWith(":")) {
      lines[i] = `${key}: ${JSON.stringify(value)}`;
    }
  }
  return lines.join("\n");
}

async function installBundledSkills(
  opts: InstallSkillsOptions = {},
): Promise<InstallSkillsResult> {
  return runInstall(
    [
      "-y",
      "skills@latest",
      "add",
      bundledSkillsDir(),
      "--global",
      "--yes",
      "--skill",
      ...bundledSkillsForChannel(),
      "--copy",
    ],
    opts,
  );
}

async function runInstall(
  args: string[],
  opts: InstallSkillsOptions,
): Promise<InstallSkillsResult> {
  const command = `npx ${args.join(" ")}`;
  if (opts.dryRun) return { ok: true, command };
  const { code } = await spawnStream({
    bin: "npx",
    args,
    cwd: process.cwd(),
    onStdoutLine: () => {},
    onStderrLine: () => {},
  });
  return { ok: code === 0, command };
}

const SHA_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

type SkillsSyncCheck = "stale" | "fresh" | "verify";

export function checkSkillsSync(
  sync: SkillsSync | undefined,
  cliVersion: string,
  ref: string,
  now: number,
): SkillsSyncCheck {
  if (!sync || sync.cliVersion !== cliVersion || sync.ref !== ref) return "stale";
  const syncedAt = Date.parse(sync.syncedAt);
  if (!Number.isFinite(syncedAt)) return "stale";
  return now - syncedAt > SHA_CHECK_INTERVAL_MS ? "verify" : "fresh";
}

async function selectSourceSha(): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${SUPERWALL_SKILLS_SOURCE}/commits/${SKILLS_REF()}`,
      {
        headers: { accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(6000),
      },
    );
    if (!res.ok) return null;
    const { sha } = (await res.json()) as { sha?: string };
    return sha ?? null;
  } catch {
    return null;
  }
}

async function skillsOutOfDate(): Promise<boolean> {
  const sync = readSkillsSync();
  const check = checkSkillsSync(sync, VERSION, SKILLS_REF(), Date.now());
  if (!sync || check === "stale") return true;
  if (check === "fresh") return false;
  const head = await selectSourceSha();
  if (!head) return false;
  if (head !== sync.sourceSha) return true;
  writeSkillsSync({ ...sync, syncedAt: new Date().toISOString() });
  return false;
}

interface SyncSkillsResult {
  ok: boolean;
  commands: string[];
}

type SkillsSyncTrigger = "login" | "workflow" | "manual";

async function syncSkills(
  opts: InstallSkillsOptions & { trigger?: SkillsSyncTrigger } = {},
): Promise<SyncSkillsResult> {
  const bundled = await installBundledSkills(opts);
  const pub = await installPublicSkills(opts);
  const ok = bundled.ok;
  if (!opts.dryRun) {
    track("skills synced", { trigger: opts.trigger ?? "manual", ok, current: pub.ok });
    if (ok && pub.ok) {
      const sourceSha = await selectSourceSha();
      writeSkillsSync({
        cliVersion: VERSION,
        syncedAt: new Date().toISOString(),
        sourceSha: sourceSha ?? undefined,
        ref: SKILLS_REF(),
      });
    }
  }
  return { ok, commands: [bundled.command, pub.command] };
}

export async function ensureSkillsCurrent(
  required = false,
  trigger: SkillsSyncTrigger = "workflow",
): Promise<void> {
  if (!required && !(await skillsOutOfDate())) return;
  const spin = ui.spinner();
  spin.start(required ? "Installing Superwall skills for your agent" : "Updating Superwall skills");
  const { ok } = await syncSkills({ trigger });
  spin.stop(
    ok
      ? required
        ? "Superwall skills installed"
        : "Superwall skills up to date"
      : "Skill install skipped",
  );
  if (required && !ok) {
    throw new Error("The integration completed, but the Superwall skills could not be installed.");
  }
}

interface SkillsInput {
  flags: { skill: string[]; force: boolean; yes: boolean; dryRun: boolean; };
}

export async function runSkills(ctx: CommandContext<"none">, { flags }: SkillsInput): Promise<void> {
  ui.intro("Superwall agent skills");

  const named = flags.skill.filter(Boolean);
  let skills = named.length ? named : undefined;
  const { dryRun } = ctx;
  const { force, yes } = flags;
  const interactive = ctx.interactive && !yes;

  if (!skills && !dryRun && !force) {
    const stale = await withSpinner("Checking your skills", skillsOutOfDate);
    if (!stale) {
      ui.success("Your Superwall skills are already up to date.");
      ui.outro("Run `superwall skills --force` to reinstall.");
      return;
    }
  }

  if (!skills && !dryRun && interactive) {
    const available = await withSpinner(
      `Fetching skills from ${SKILLS_INSTALL_SOURCE()}`,
      listPublicSkills,
    );
    const picked = await ui.multiselect({
      message: `Which skills from ${SKILLS_INSTALL_SOURCE()}? (installs globally)`,
      options: available.map((s) => ({
        value: s.name,
        label: s.name,
        hint: s.summary,
      })),
      initialValues: available.map((s) => s.name),
    });
    if (picked === null || picked.length === 0) {
      ui.warn("Nothing selected.");
      return;
    }
    skills = picked.length === available.length ? undefined : picked;
  } else if (skills?.length) {
    ui.info(`Installing \`${skills.join("`, `")}\` from ${SKILLS_INSTALL_SOURCE()}`);
  } else {
    ui.info(`Installing every skill from ${SKILLS_INSTALL_SOURCE()}`);
  }

  const spin = ui.spinner();
  spin.start(dryRun ? "Resolving" : "Installing skills globally");
  const { ok, commands } = await syncSkills({ skills, dryRun });
  spin.stop(
    dryRun ? "Dry run" : ok ? "Skills installed for every detected agent" : "Install failed",
  );

  if (dryRun) for (const command of commands) ui.info(command);
  ui.outro(
    ok
      ? `**Done.** Try: ask your agent to "review my Superwall setup".`
      : "Something went wrong - try again, or check that `npx` is available.",
  );
  if (!ok) {
    throw new Error("Skill installation failed. Check that `npx` is available and try again.");
  }
}
