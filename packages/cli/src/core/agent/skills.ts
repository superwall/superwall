import { readFileSync } from "node:fs";
import { VERSION } from "@/environment";
import { track } from "@/core/telemetry";
import { ui } from "@/ui";
import { packagedDir } from "@/packaged";
import { getSkillsSync, setSkillsSync, type SkillsSync } from "@/core/state/config";
import { spawnStream } from "./drivers/spawn";

export type BundledSkillId =
  | "superwall-integrate"
  | "superwall-migrate"
  | "superwall-paywall-migrate"
  | "superwall-review"
  | "superwall-placements"
  | "superwall-dashboard";

const cache = new Map<string, string>();

export function bundledSkillsDir(): string {
  return packagedDir("skills").replace(/\/$/, "");
}

/** SKILL.md body, plus references/<name>.md for each given reference (framework/provider depth). */
export function loadBundledSkill(
  id: BundledSkillId,
  reference?: string | Array<string | undefined>,
): string {
  const refs = (Array.isArray(reference) ? reference : [reference]).filter((r): r is string => !!r);
  const key = refs.length ? `${id}#${refs.join("+")}` : id;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const skill = readSkillFile(`${id}/SKILL.md`);
  const bodies = refs.map((r) => readSkillFile(`${id}/references/${r}.md`));
  const body = [skill, ...bodies].filter(Boolean).join("\n\n");
  cache.set(key, body);
  return body;
}

function readSkillFile(rel: string): string {
  try {
    return stripFrontmatter(readFileSync(`${packagedDir("skills")}${rel}`, "utf8")).trim();
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

export const SUPERWALL_SKILLS_SOURCE = "superwall/skills";

export interface SkillInfo {
  name: string;
  summary: string;
}

export const KNOWN_SKILLS: SkillInfo[] = [
  {
    name: "superwall",
    summary: "Resources, ClickHouse SQL analytics, docs, SDK triage, and dashboard links",
  },
  {
    name: "superwall-editor",
    summary: "Build and edit live paywalls, onboarding, and web2app flows from the CLI",
  },
];

export async function fetchPublicSkills(): Promise<SkillInfo[]> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${SUPERWALL_SKILLS_SOURCE}/contents/skills`,
      {
        headers: { accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(6000),
      },
    );
    if (!res.ok) return KNOWN_SKILLS;
    const entries = (await res.json()) as Array<{ name: string; type: string }>;
    const dirs = entries.filter((e) => e.type === "dir").map((e) => e.name);
    if (dirs.length === 0) return KNOWN_SKILLS;
    const skills = await Promise.all(
      dirs.map(
        async (name): Promise<SkillInfo> => ({
          name,
          summary: await fetchSkillSummary(name),
        }),
      ),
    );
    // Main skill first, rest alphabetical.
    return skills.sort((a, b) =>
      a.name === "superwall" ? -1 : b.name === "superwall" ? 1 : a.name.localeCompare(b.name),
    );
  } catch {
    return KNOWN_SKILLS;
  }
}

async function fetchSkillSummary(name: string): Promise<string> {
  try {
    const res = await fetch(
      `https://raw.githubusercontent.com/${SUPERWALL_SKILLS_SOURCE}/main/skills/${name}/SKILL.md`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) return "";
    const raw = (await res.text()).match(/^description:\s*(.+)$/m)?.[1] ?? "";
    const description = raw.trim().replace(/^["']|["'`]+$/g, "");
    const firstSentence = description.split(/(?<=\.)\s/)[0] ?? description;
    return firstSentence.length > 64 ? `${firstSentence.slice(0, 61)}...` : firstSentence;
  } catch {
    return "";
  }
}

export interface InstallSkillsOptions {
  skills?: string[];
  cwd?: string;
  dryRun?: boolean;
  onProgress?: (line: string) => void;
}

export interface InstallSkillsResult {
  ok: boolean;
  command: string;
}

export async function installPublicSkills(
  opts: InstallSkillsOptions = {},
): Promise<InstallSkillsResult> {
  const args = ["-y", "skills@latest", "add", SUPERWALL_SKILLS_SOURCE, "--global", "--yes"];
  if (opts.skills?.length) args.push("--skill", ...opts.skills);
  else args.push("--skill", "*");
  return runInstall(args, opts);
}

// `--copy` so the skills live independently of this package's install path.
export async function installBundledSkills(
  opts: InstallSkillsOptions = {},
): Promise<InstallSkillsResult> {
  return runInstall(
    ["-y", "skills@latest", "add", bundledSkillsDir(), "--global", "--yes", "--copy"],
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
    cwd: opts.cwd ?? process.cwd(),
    onStdoutLine: (line) => opts.onProgress?.(line),
    onStderrLine: (line) => opts.onProgress?.(line),
  });
  return { ok: code === 0, command };
}

const SHA_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type SkillsSyncCheck = "stale" | "fresh" | "verify";

// Bundled skills ship inside this package, so a CLI version change is always
// stale. The public repo moves on its own: after a day, verify its HEAD commit
// against the recorded one instead of trusting the clock.
export function checkSkillsSync(
  sync: SkillsSync | undefined,
  cliVersion: string,
  now: number,
): SkillsSyncCheck {
  if (!sync || sync.cliVersion !== cliVersion) return "stale";
  const syncedAt = Date.parse(sync.syncedAt);
  if (!Number.isFinite(syncedAt)) return "stale";
  return now - syncedAt > SHA_CHECK_INTERVAL_MS ? "verify" : "fresh";
}

async function fetchSourceSha(): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${SUPERWALL_SKILLS_SOURCE}/commits/main`,
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

export async function skillsOutOfDate(): Promise<boolean> {
  const sync = getSkillsSync();
  const check = checkSkillsSync(sync, VERSION, Date.now());
  if (check === "stale") return true;
  if (check === "fresh" || !sync) return false;
  const head = await fetchSourceSha();
  // Offline or rate-limited: keep what we have rather than churn.
  if (!head) return false;
  if (head !== sync.sourceSha) return true;
  setSkillsSync({ ...sync, syncedAt: new Date().toISOString() });
  return false;
}

export interface SyncSkillsResult {
  ok: boolean;
  commands: string[];
}

export type SkillsSyncTrigger = "login" | "workflow" | "manual";

export async function syncSkills(
  opts: InstallSkillsOptions & { trigger?: SkillsSyncTrigger } = {},
): Promise<SyncSkillsResult> {
  const pub = await installPublicSkills(opts);
  const bundled = await installBundledSkills(opts);
  const ok = pub.ok && bundled.ok;
  if (!opts.dryRun) {
    track("skills synced", { trigger: opts.trigger ?? "manual", ok });
    if (ok)
      setSkillsSync({
        cliVersion: VERSION,
        syncedAt: new Date().toISOString(),
        sourceSha: (await fetchSourceSha()) ?? undefined,
      });
  }
  return { ok, commands: [pub.command, bundled.command] };
}

/**
 * Install or refresh the skills with a spinner. `required` always installs and
 * throws on failure (fresh integrations must ship with skills); otherwise this
 * is a quiet refresh that no-ops when the last sync is current.
 */
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
  if (required && !ok)
    throw new Error("The integration completed, but the Superwall skills could not be installed.");
}
