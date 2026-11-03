import * as fs from "node:fs";
import * as path from "node:path";
import pc from "picocolors";
import type { CommandContext } from "@/program/command";
import type { SuperwallApi } from "@/core/api/client";
import { appNotFound, findApplication } from "@/core/api/lookup";
import { listAppPaywalls, mintSourceAccess, type HeadlessPaywallRef } from "@/core/api/resources";
import { PLATFORMS, requirePlatform } from "@/core/paywalls/binding/apps";
import { parsePlatformFlags } from "@/core/paywalls/binding/targets";
import { requireProject, resolveProjectDir } from "@/core/paywalls/pipeline/selection";
import { resolveFramework } from "@/core/paywalls/project/framework";
import { detectPackageManager, devCommand } from "@/core/paywalls/project/setup";
import {
  NewerLockError,
  parseLock,
  readLock,
  writeLock,
  type LockFile,
  type SurfaceBindings,
} from "@/core/paywalls/project/lock";
import { requireApi } from "@/core/paywalls/project/session";
import {
  collectProjectDeclarations,
  TYPES_FILE,
  writeProjectTypes,
} from "@/core/paywalls/project/types";
import { readSourceBase, writeSourceBase } from "@/core/paywalls/source/base";
import { pullSourceTree, type PulledChange } from "@/core/paywalls/source/git";
import { collectSourceFiles } from "@/core/paywalls/source/source";
import { VERSION } from "@/environment";
import { ui } from "@/ui";

interface PullInput {
  args: { dir: string | undefined };
  flags: { app?: string; platform: string[]; theirs: boolean };
}

export interface PulledApp {
  applicationId: string;
  platforms: string[];
}

export function appsToPull(lock: LockFile, only: readonly string[]): PulledApp[] {
  for (const platform of only) {
    if (!PLATFORMS.some((known) => known === platform)) {
      throw new Error(`"${platform}" is not a platform — use one of ${PLATFORMS.join(", ")}.`);
    }
  }
  const byApp = new Map<string, string[]>();
  for (const [platform, applicationId] of Object.entries(lock.apps)) {
    if (only.length > 0 && !only.includes(platform)) continue;
    byApp.set(applicationId, [...(byApp.get(applicationId) ?? []), platform]);
  }
  return [...byApp].map(([applicationId, platforms]) => ({ applicationId, platforms }));
}

export function boundPaywall(lock: LockFile, platforms: readonly string[]): string | undefined {
  for (const section of [lock.paywalls, lock.funnels]) {
    for (const bindings of Object.values(section)) {
      for (const platform of platforms) {
        const binding = bindings[platform];
        if (binding) return binding.paywallId;
      }
    }
  }
  return undefined;
}

const mergeSection = (
  local: Record<string, SurfaceBindings>,
  remote: Record<string, SurfaceBindings>,
): Record<string, SurfaceBindings> => {
  const merged: Record<string, SurfaceBindings> = {};
  for (const id of new Set([...Object.keys(remote), ...Object.keys(local)])) {
    const mine = local[id] ?? {};
    const theirs = remote[id] ?? {};
    const bindings: SurfaceBindings = {};
    for (const platform of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
      const own = mine[platform];
      const other = theirs[platform];
      const keep =
        !other || (own && (own.sourcePending !== undefined || own.paywallId !== other.paywallId));
      const chosen = keep ? own : other;
      if (chosen) bindings[platform] = chosen;
    }
    merged[id] = bindings;
  }
  return merged;
};

export function mergePulledLock(local: LockFile, remoteText: string | undefined): LockFile {
  if (remoteText === undefined) return local;
  let remote: LockFile;
  try {
    remote = parseLock(remoteText, "The source repo's superwall.lock");
  } catch (error) {
    if (error instanceof NewerLockError) throw error;
    ui.warn(
      `The source repo's superwall.lock can't be read (${error instanceof Error ? error.message : String(error)}) — kept your bindings as they are.`,
    );
    return local;
  }
  const merged: LockFile = {
    version: 1,
    apps: { ...remote.apps, ...local.apps },
    paywalls: mergeSection(local.paywalls, remote.paywalls),
    funnels: mergeSection(local.funnels, remote.funnels),
  };
  const origins = { ...remote.origins, ...local.origins };
  if (Object.keys(origins).length > 0) merged.origins = origins;
  if (local.sources) merged.sources = local.sources;
  return merged;
}

export function applyPulledChanges(
  superwallDir: string,
  changes: readonly PulledChange[],
  tracked: ReadonlySet<string>,
): { written: string[]; skipped: string[] } {
  const written: string[] = [];
  const skipped: string[] = [];
  for (const change of changes) {
    const target = path.join(superwallDir, change.path);
    if (!tracked.has(change.path) && fs.existsSync(target)) {
      skipped.push(change.path);
      continue;
    }
    if (change.content === undefined) {
      fs.rmSync(target, { force: true });
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, change.content);
    }
    written.push(change.path);
  }
  return { written, skipped };
}

async function paywallFor(
  api: SuperwallApi,
  lock: LockFile,
  app: PulledApp,
): Promise<string | undefined> {
  const bound = boundPaywall(lock, app.platforms);
  if (bound) return bound;
  return (await firstHeadlessPaywall(api, app.applicationId))?.id;
}

async function firstHeadlessPaywall(
  api: SuperwallApi,
  applicationId: string,
): Promise<HeadlessPaywallRef | undefined> {
  const paywalls = await listAppPaywalls(api, applicationId);
  return paywalls.find((paywall) => paywall.metadata.headless === "true");
}

const SHOWN = 8;

const describeChanges = (files: readonly string[]): string[] => [
  ...files.slice(0, SHOWN).map((file) => `  ${pc.dim(file)}`),
  ...(files.length > SHOWN ? [`  ${pc.dim(`and ${files.length - SHOWN} more`)}`] : []),
];

const LOCK_FILE = "superwall.lock";

export function cloneTarget(root: string): string {
  if (fs.existsSync(path.join(root, LOCK_FILE))) {
    throw new Error(
      `\`${root}\` is already a superwall project — run \`superwall pull\` there without --app.`,
    );
  }
  const superwallDir = path.join(root, "superwall");
  if (fs.existsSync(superwallDir) && fs.readdirSync(superwallDir).length > 0) {
    throw new Error(
      fs.existsSync(path.join(superwallDir, LOCK_FILE))
        ? `\`${superwallDir}\` is already a superwall project — run \`superwall pull\` there without --app.`
        : `\`${superwallDir}\` already has files — pull --app only fills an empty folder; pick another directory.`,
    );
  }
  return superwallDir;
}

async function runClone(
  appRef: string,
  root: string,
  flags: PullInput["flags"],
  api: SuperwallApi,
): Promise<void> {
  if (flags.theirs || flags.platform.length > 0) {
    throw new Error(
      "--app sets up a new folder from the app's source — drop --theirs and --platform.",
    );
  }
  const superwallDir = cloneTarget(root);

  const found = await findApplication(api, appRef);
  if (!found) throw appNotFound(appRef);
  const applicationId = String(found.app.id);
  const platform = requirePlatform(found.app);
  const paywall = await firstHeadlessPaywall(api, applicationId);
  if (!paywall) {
    throw new Error(
      `App ${applicationId} has no code paywall on Superwall yet, so it has no source to pull — ` +
        `start one with \`superwall create --app ${applicationId}\`.`,
    );
  }

  ui.intro(`Superwall ${pc.dim(`v${VERSION}`)}`);
  const access = await mintSourceAccess(api, paywall.id);
  const pulled = await pullSourceTree({ access, files: [] });
  if (pulled.status === "empty") {
    throw new Error(
      `App ${applicationId}'s source repo is empty — nobody has pushed from code yet. ` +
        `Start a project with \`superwall create --app ${applicationId}\`.`,
    );
  }

  fs.mkdirSync(superwallDir, { recursive: true });
  const { written } = applyPulledChanges(superwallDir, pulled.changes, new Set());
  if (pulled.types !== undefined)
    fs.writeFileSync(path.join(superwallDir, TYPES_FILE), pulled.types);
  const bound: LockFile = {
    version: 1,
    apps: { [platform]: applicationId },
    paywalls: {},
    funnels: {},
  };
  writeLock(superwallDir, mergePulledLock(bound, pulled.lock));
  writeSourceBase(superwallDir, access.repo, pulled.head);

  const manager = await detectPackageManager(superwallDir);
  const where = path.relative(process.cwd(), superwallDir) || ".";
  ui.info(
    [
      `${pc.bold(`${platform} app ${applicationId}`)} pulled ${written.length} ${written.length === 1 ? "file" : "files"} into ${where}`,
      ...describeChanges(written),
    ].join("\n"),
  );
  ui.outro(`Next: cd ${where} && ${manager} install && ${devCommand(manager)}`);
}

export async function runPull(
  ctx: CommandContext<"none">,
  { args, flags }: PullInput,
): Promise<void> {
  const api = await requireApi(ctx.interactive);
  const dir = resolveProjectDir(args.dir);
  if (flags.app !== undefined) return runClone(flags.app, dir, flags, api);
  const framework = await resolveFramework(dir);
  const project = requireProject(framework.discoverProject(dir), dir);
  const { superwallDir } = project;
  const apps = appsToPull(readLock(superwallDir), parsePlatformFlags(flags.platform));
  if (apps.length === 0) {
    throw new Error(
      flags.platform.length > 0
        ? `superwall.lock binds no app for ${parsePlatformFlags(flags.platform).join(", ")} — drop --platform or push to it first.`
        : "superwall.lock binds no app yet, so there is no source repo to pull from — push once to connect one.",
    );
  }

  ui.intro(`Superwall ${pc.dim(`v${VERSION}`)}`);
  let changed = false;

  for (const app of apps) {
    const label = `${app.platforms.join(", ")} app ${app.applicationId}`;
    const paywallId = await paywallFor(api, readLock(superwallDir), app);
    if (!paywallId) {
      ui.step(`${label}: no code paywall on Superwall yet — nothing to pull`);
      continue;
    }
    const access = await mintSourceAccess(api, paywallId);
    const collected = await collectSourceFiles(superwallDir);
    if (!collected.ok) throw new Error(collected.reason);
    const { files } = collected;
    const pulled = await pullSourceTree({
      access,
      files,
      base: readSourceBase(superwallDir, access.repo),
      theirs: flags.theirs,
    });
    if (pulled.status === "empty") {
      ui.step(`${label}: its source repo is empty — nothing to pull yet`);
      continue;
    }

    const lock = mergePulledLock(readLock(superwallDir), pulled.lock);
    const { written, skipped } = applyPulledChanges(
      superwallDir,
      pulled.changes,
      new Set(files.map((file) => file.path)),
    );
    writeLock(superwallDir, lock);
    writeSourceBase(superwallDir, access.repo, pulled.head);
    if (written.length > 0) changed = true;

    if (skipped.length > 0) {
      ui.warn(
        `Left ${skipped.join(", ")} as they are: they're ignored here and would overwrite your local copies.`,
      );
    }
    if (written.length === 0) ui.step(`${label}: already up to date`);
    else
      ui.info(
        [
          `${pc.bold(label)} pulled ${written.length} ${written.length === 1 ? "file" : "files"}`,
          ...describeChanges(written),
        ].join("\n"),
      );
  }

  if (changed) {
    const refreshed = framework.discoverProject(dir);
    writeProjectTypes(
      refreshed,
      (await collectProjectDeclarations(framework, refreshed.root)).products,
    );
  }
  ui.outro("Pulled. Publish from here: your next push merges on top of what you pulled.");
}
