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
  originKey,
  parseLock,
  readLock,
  writeLock,
  type LockFile,
  type SurfaceBinding,
  type SurfaceBindings,
} from "@/core/paywalls/project/lock";
import { requireApi } from "@/core/paywalls/project/session";
import {
  collectProjectDeclarations,
  TYPES_FILE,
  writeProjectTypes,
} from "@/core/paywalls/project/types";
import { readSourceBase, writeSourceBase } from "@/core/paywalls/source/base";
import {
  pullSourceTree,
  statIfPresent,
  type PulledChange,
  type SourceAccess,
} from "@/core/paywalls/source/git";
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

const sameBinding = (a: SurfaceBinding | undefined, b: SurfaceBinding | undefined): boolean =>
  a?.paywallId === b?.paywallId && a?.snapshot === b?.snapshot;

function chooseBinding(
  own: SurfaceBinding | undefined,
  other: SurfaceBinding | undefined,
  synced: SurfaceBinding | undefined,
  threeWay: boolean,
): SurfaceBinding | undefined {
  if (own?.sourcePending !== undefined) return own;
  if (threeWay) {
    if (sameBinding(other, synced)) return own;
    if (sameBinding(own, synced)) return other;
  }
  if (!other) return own;
  return own && own.paywallId !== other.paywallId ? own : other;
}

const mergeSection = (
  local: Record<string, SurfaceBindings>,
  remote: Record<string, SurfaceBindings>,
  base: Record<string, SurfaceBindings> | undefined,
): Record<string, SurfaceBindings> => {
  const ids = [...Object.keys(local), ...Object.keys(remote).filter((id) => !(id in local))];
  const chosen = ids.map((id) => {
    const mine = local[id] ?? {};
    const theirs = remote[id] ?? {};
    const platforms = [...new Set([...Object.keys(theirs), ...Object.keys(mine)])];
    return {
      id,
      picks: platforms.map((platform) => ({
        platform,
        own: mine[platform],
        binding: chooseBinding(
          mine[platform],
          theirs[platform],
          base?.[id]?.[platform],
          base !== undefined,
        ),
      })),
    };
  });
  const bound = new Map<string, Set<string>>();
  const bind = (platform: string, paywallId: string) =>
    bound.set(platform, (bound.get(platform) ?? new Set<string>()).add(paywallId));
  for (const { picks } of chosen) {
    for (const { platform, own, binding } of picks) {
      if (binding && binding === own) bind(platform, binding.paywallId);
    }
  }
  const merged: Record<string, SurfaceBindings> = {};
  for (const { id, picks } of chosen) {
    const bindings: SurfaceBindings = {};
    for (const { platform, own, binding } of picks) {
      if (!binding) continue;
      if (binding !== own) {
        if (bound.get(platform)?.has(binding.paywallId)) {
          if (own) bindings[platform] = own;
          continue;
        }
        bind(platform, binding.paywallId);
      }
      bindings[platform] = binding;
    }
    const emptyHere = id in local && Object.keys(local[id] ?? {}).length === 0;
    if (Object.keys(bindings).length > 0 || emptyHere) merged[id] = bindings;
  }
  return merged;
};

function sharedPlatforms(
  local: LockFile,
  remote: LockFile,
  platforms: readonly string[] | undefined,
): Set<string> {
  const shared = new Set<string>();
  for (const [platform, applicationId] of Object.entries(remote.apps)) {
    if (platforms !== undefined && !platforms.includes(platform)) continue;
    const mine = local.apps[platform];
    if (mine !== undefined && mine !== applicationId) continue;
    shared.add(platform);
  }
  return shared;
}

const onlyPlatforms = (
  section: Record<string, SurfaceBindings>,
  allowed: ReadonlySet<string>,
): Record<string, SurfaceBindings> => {
  const kept: Record<string, SurfaceBindings> = {};
  for (const [id, bindings] of Object.entries(section)) {
    const entries = Object.entries(bindings).filter(([platform]) => allowed.has(platform));
    if (entries.length > 0) kept[id] = Object.fromEntries(entries);
  }
  return kept;
};

function syncedLock(text: string | undefined): LockFile | undefined {
  if (text === undefined) return undefined;
  try {
    return parseLock(text, "The superwall.lock at the last sync");
  } catch {
    return undefined;
  }
}

export function mergePulledLock(
  local: LockFile,
  remoteText: string | undefined,
  platforms?: readonly string[],
  baseText?: string,
): LockFile {
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
  const allowed = sharedPlatforms(local, remote, platforms);
  const apps = Object.fromEntries(
    Object.entries(remote.apps).filter(([platform]) => allowed.has(platform)),
  );
  const base = syncedLock(baseText);
  const merged: LockFile = {
    version: 1,
    apps: { ...apps, ...local.apps },
    paywalls: mergeSection(
      local.paywalls,
      onlyPlatforms(remote.paywalls, allowed),
      base && onlyPlatforms(base.paywalls, allowed),
    ),
    funnels: mergeSection(
      local.funnels,
      onlyPlatforms(remote.funnels, allowed),
      base && onlyPlatforms(base.funnels, allowed),
    ),
  };
  const kept = new Set([
    ...Object.keys(merged.paywalls).map((id) => originKey("paywall", id)),
    ...Object.keys(merged.funnels).map((id) => originKey("funnel", id)),
  ]);
  const theirOrigins = Object.fromEntries(
    Object.entries(remote.origins ?? {}).filter(([key]) => kept.has(key)),
  );
  const origins = { ...theirOrigins, ...local.origins };
  if (Object.keys(origins).length > 0) merged.origins = origins;
  if (local.sources) merged.sources = local.sources;
  return merged;
}

export class PullPathError extends Error {}

function assertInside(superwallDir: string, relative: string): void {
  const parts = relative.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new PullPathError(
      `The source repo has an unsafe path, ${relative} — nothing was pulled.`,
    );
  }
  for (let depth = 1; depth <= parts.length; depth++) {
    const at = path.join(superwallDir, ...parts.slice(0, depth));
    const stat = fs.lstatSync(at, { throwIfNoEntry: false });
    if (stat === undefined) return;
    if (!stat.isSymbolicLink() && !stat.isDirectory()) return;
    if (stat.isSymbolicLink()) {
      throw new PullPathError(
        `${parts.slice(0, depth).join("/")} is a symlink in this project, so the CLI won't write ${relative} through it — nothing was pulled. Replace the symlink with a folder, then pull again.`,
      );
    }
  }
}

function pruneEmpty(superwallDir: string, from: string): void {
  let dir = path.dirname(from);
  while (
    dir.startsWith(superwallDir + path.sep) &&
    fs.existsSync(dir) &&
    fs.readdirSync(dir).length === 0
  ) {
    fs.rmdirSync(dir);
    dir = path.dirname(dir);
  }
}

function blockedByFile(
  superwallDir: string,
  relative: string,
  deleting: ReadonlySet<string>,
): boolean {
  const parts = relative.split("/");
  for (let depth = 1; depth < parts.length; depth++) {
    const prefix = parts.slice(0, depth).join("/");
    const stat = statIfPresent(path.join(superwallDir, prefix));
    if (stat === undefined) return false;
    if (stat.isDirectory()) continue;
    return !deleting.has(prefix);
  }
  return false;
}

export function applyPulledChanges(
  superwallDir: string,
  changes: readonly PulledChange[],
  tracked: ReadonlySet<string>,
): { written: string[]; skipped: string[] } {
  for (const change of changes) assertInside(superwallDir, change.path);
  const skipped: string[] = [];
  const planned: PulledChange[] = [];
  const removing = new Set(
    changes
      .filter((change) => change.content === undefined && tracked.has(change.path))
      .map((change) => change.path),
  );
  const cleared = (relative: string): boolean =>
    fs
      .readdirSync(path.join(superwallDir, relative), { recursive: true, withFileTypes: true })
      .filter((entry) => !entry.isDirectory())
      .every((entry) =>
        removing.has(
          path
            .relative(superwallDir, path.join(entry.parentPath, entry.name))
            .split(path.sep)
            .join("/"),
        ),
      );
  for (const change of changes) {
    const existing = statIfPresent(path.join(superwallDir, change.path));
    const untrackedInTheWay =
      !tracked.has(change.path) &&
      existing !== undefined &&
      !(existing.isDirectory() && change.content !== undefined && cleared(change.path));
    if (untrackedInTheWay) skipped.push(change.path);
    else planned.push(change);
  }
  const deleting = new Set(
    planned.filter((change) => change.content === undefined).map((change) => change.path),
  );
  const applied = planned.filter((change) => {
    if (!blockedByFile(superwallDir, change.path, deleting)) return true;
    skipped.push(change.path);
    return false;
  });
  const ordered = [
    ...applied.filter((change) => change.content === undefined),
    ...applied.filter((change) => change.content !== undefined),
  ];
  const written: string[] = [];
  for (const change of ordered) {
    const target = path.join(superwallDir, change.path);
    if (change.content === undefined) {
      fs.rmSync(target, { force: true });
      pruneEmpty(superwallDir, target);
    } else {
      if (statIfPresent(target)?.isDirectory()) fs.rmSync(target, { recursive: true });
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, change.content);
    }
    written.push(change.path);
  }
  return { written: written.sort(), skipped: skipped.sort() };
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

export async function pullInto(
  superwallDir: string,
  access: SourceAccess,
  theirs: boolean,
  platforms?: readonly string[],
): Promise<{ written: string[]; skipped: string[] } | undefined> {
  const collected = await collectSourceFiles(superwallDir);
  if (!collected.ok) throw new Error(collected.reason);
  const { files } = collected;
  const pulled = await pullSourceTree({
    access,
    files,
    base: readSourceBase(superwallDir, access.repo),
    theirs,
  });
  if (pulled.status === "empty") return undefined;
  const lock = mergePulledLock(readLock(superwallDir), pulled.lock, platforms, pulled.baseLock);
  const applied = applyPulledChanges(
    superwallDir,
    pulled.changes,
    new Set(files.map((file) => file.path)),
  );
  writeLock(superwallDir, lock);
  writeSourceBase(superwallDir, access.repo, pulled.head);
  return applied;
}

export async function cloneInto(
  superwallDir: string,
  access: SourceAccess,
  apps: Record<string, string>,
): Promise<string[] | undefined> {
  const pulled = await pullSourceTree({ access, files: [] });
  if (pulled.status === "empty") return undefined;
  const lock = mergePulledLock({ version: 1, apps, paywalls: {}, funnels: {} }, pulled.lock);
  const created = !fs.existsSync(superwallDir);
  fs.mkdirSync(superwallDir, { recursive: true });
  let written: string[];
  try {
    ({ written } = applyPulledChanges(superwallDir, pulled.changes, new Set()));
  } catch (error) {
    if (created) fs.rmSync(superwallDir, { recursive: true, force: true });
    else
      for (const entry of fs.readdirSync(superwallDir))
        fs.rmSync(path.join(superwallDir, entry), { recursive: true, force: true });
    throw error;
  }
  if (pulled.types !== undefined)
    fs.writeFileSync(path.join(superwallDir, TYPES_FILE), pulled.types);
  writeLock(superwallDir, lock);
  writeSourceBase(superwallDir, access.repo, pulled.head);
  return written;
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
  const written = await cloneInto(superwallDir, access, { [platform]: applicationId });
  if (written === undefined) {
    throw new Error(
      `App ${applicationId}'s source repo is empty — nobody has pushed from code yet. ` +
        `Start a project with \`superwall create --app ${applicationId}\`.`,
    );
  }

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
    const pulled = await pullInto(
      superwallDir,
      access,
      flags.theirs,
      flags.platform.length > 0 ? app.platforms : undefined,
    );
    if (pulled === undefined) {
      ui.step(`${label}: its source repo is empty — nothing to pull yet`);
      continue;
    }
    const { written, skipped } = pulled;
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
