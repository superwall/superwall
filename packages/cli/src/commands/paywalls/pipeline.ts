import { cpus } from "node:os";
import { globSync, statSync } from "node:fs";
import { resolve } from "node:path";
import pc from "picocolors";
import type { CommandContext } from "@/command";
import {
  livePaywall,
  promotePaywallVersion,
  pushPaywallVersion,
  versionProducts,
} from "@/core/api/resources";
import { assetBaseUrl, requireAssets, syncAssets } from "@/core/paywalls/assets";
import {
  resolveApplicationId,
  resolveBinding,
  type ResolvedBinding,
} from "@/core/paywalls/binding/binding";
import { collectProjectProducts, writeProjectTypes } from "@/core/paywalls/project/types";
import { readLock, writeSnapshot } from "@/core/paywalls/project/lock";
import {
  frameworkVersion,
  loadFramework,
  type Framework,
  type FrameworkProject,
  type FrameworkSurface,
} from "@/core/paywalls/project/framework";
import {
  fetchProducts,
  projectForApplication,
  requireProducts,
} from "@/core/paywalls/products";
import { warnNotPortable } from "@/core/paywalls/source/portability";
import { parseRenameFlags, resolveRenames } from "@/core/paywalls/binding/renames";
import { writeProjectScaffold } from "@/core/paywalls/project/scaffold";
import { collectSourceFiles } from "@/core/paywalls/source/source";
import { pushSource } from "@/core/paywalls/source/source-push";
import { VERSION } from "@/constants";
import { ui } from "@/ui";
import { pickApplicationOption } from "./pick-app";
import { pickRenameOption } from "./pick-rename";
import { pickStaleOption } from "./pick-stale";

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} kB`;

const weight = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : kb(bytes);

const SHORT_SHA = 7;

const shortSha = (sha: string | undefined): string | undefined =>
  typeof sha === "string" && sha.length >= SHORT_SHA ? sha.slice(0, SHORT_SHA) : undefined;

export function pushedLine(input: {
  version: number;
  snapshotId?: string;
  live?: number;
  promoting: boolean;
}): string {
  const sha = shortSha(input.snapshotId);
  const version = input.promoting
    ? `version ${input.version}`
    : pc.yellow(`version ${input.version}`);
  const pushed = `Pushed ${version}${sha ? ` ${pc.dim(`(${sha})`)}` : ""}`;
  return input.promoting || input.live === undefined
    ? pushed
    : `${pushed} · ${pc.dim(`live ${input.live}`)}`;
}

export function transition(before: number | undefined, after: number): string {
  if (before === undefined) return `Promoted ${pc.green(`version ${after}`)}`;
  if (before === after) return `Version ${pc.green(String(after))} already live`;
  if (after < before) return `Rolled back ${pc.green(`version ${before} → ${after}`)}`;
  return `Promoted ${pc.green(`version ${before} → ${after}`)}`;
}

const BIND_VERB: Record<ResolvedBinding["source"], string> = {
  lock: "Linked to",
  matched: "Linked to",
  created: "Created",
  renamed: "Rebound after rename to",
};

export const LAYOUT_HINT =
  "expected superwall/{paywalls,funnels}/<id>/ with config.ts and app/index.tsx";

export function projectDir(context: CommandContext): string {
  const [first] = projectDirs(context);
  return first ?? process.cwd();
}

export function projectDirs(context: CommandContext): string[] {
  const raw = context.argv.dir;
  const list = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  if (list.length === 0) return [process.cwd()];

  const expanded = list.flatMap((entry) => (entry.includes("*") ? expandGlob(entry) : [entry]));
  return [...new Set(expanded.map((entry) => resolve(entry)))];
}

function expandGlob(pattern: string): string[] {
  try {
    return [...globSync(pattern)]
      .filter((entry) => statSync(entry, { throwIfNoEntry: false })?.isDirectory() ?? false)
      .sort();
  } catch {
    return [pattern];
  }
}

export function requireProject(project: FrameworkProject, dir: string): FrameworkProject {
  if (!project.marker) {
    throw new Error(
      `Not a superwall project: ${dir}\n` +
        "Expected a package.json here (or in superwall/) that depends on superwall.",
    );
  }
  if (project.packageName === "superwall") {
    throw new Error(
      `${project.superwallDir}/package.json is named "superwall".\n` +
        'Node resolves every bare `import "superwall"` inside a package to that package ' +
        "itself, so the framework can never load. Rename it to your project's name.",
    );
  }
  return project;
}

export function parseIds(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return raw
    .flatMap((entry) => (typeof entry === "string" ? entry.split(",") : []))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function selectSurfaces(project: FrameworkProject, ids: unknown): FrameworkSurface[] {
  const wanted = parseIds(ids);
  const known = project.surfaces.map((surface) => surface.id).join(", ");

  if (wanted.length === 0) {
    if (project.surfaces.length === 0) {
      throw new Error(`No paywalls or funnels found — ${LAYOUT_HINT}.`);
    }
    return [...project.surfaces];
  }

  const selected: FrameworkSurface[] = [];
  for (const id of wanted) {
    const matches = project.surfaces.filter((surface) => surface.id === id);
    if (matches.length === 0) {
      throw new Error(
        `No paywall or funnel named "${id}"` +
          (known ? ` — this project has: ${known}.` : ` — ${LAYOUT_HINT}.`),
      );
    }
    if (matches.length > 1) {
      const kinds = matches.map((surface) => `${surface.kind}/${surface.id}`).join(" and ");
      throw new Error(`"${id}" is ambiguous — this project has ${kinds}.`);
    }
    const surface = matches[0];
    if (surface && !selected.includes(surface)) selected.push(surface);
  }
  return selected;
}

export function requireClean(surfaces: readonly FrameworkSurface[]): void {
  const problems = surfaces.flatMap((surface) => surface.diagnostics ?? []);
  if (problems.length === 0) return;
  throw new Error(
    [...problems, "", "Publishing is immutable — fix these first, then push again."].join("\n"),
  );
}

export function needsWork(
  built: string,
  pushed: string | undefined,
  live: string | undefined,
): boolean {
  return built !== pushed && built !== live;
}

async function pooled<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await work(item, index);
    }
  });
  await Promise.all(runners);
  return results;
}

const NOTE_LIMIT = 2000;

const PENDING_NAMES = 10;

export function pendingPromoteWarning(ids: readonly string[]): string | undefined {
  if (ids.length === 0) return undefined;
  const command = `superwall promote --id ${ids.join(",")}`;
  if (ids.length === 1) {
    return `${ids[0]} is pushed but not live — run \`${command}\` to publish it.`;
  }
  const shown = ids.slice(0, PENDING_NAMES).map((id) => `  ${id}`);
  const rest = ids.length - shown.length;
  return [
    `These ${ids.length} paywalls are pushed but not live:`,
    ...shown,
    ...(rest > 0 ? [`  …and ${rest} more`] : []),
    "",
    `  ${command}`,
  ].join("\n");
}

function resolveNote(message: unknown): string | undefined {
  if (typeof message !== "string") return undefined;
  if (message.length > NOTE_LIMIT) {
    throw new Error(`Publish note is ${message.length} characters (limit ${NOTE_LIMIT}).`);
  }
  return message;
}

const took = (since: number): string => {
  const seconds = (Date.now() - since) / 1000;
  return pc.dim(seconds < 10 ? `(${seconds.toFixed(1)}s)` : `(${Math.round(seconds)}s)`);
};

async function timed<T>(work: () => Promise<T>): Promise<{ value: T; took: string }> {
  const at = Date.now();
  const value = await work();
  return { value, took: took(at) };
}

async function group(
  context: CommandContext,
  id: string,
  work: (note: (message: string) => void) => Promise<string[]>,
): Promise<void> {
  const spin = context.outputMode === "rich" ? ui.spinner() : undefined;
  spin?.start(id);
  try {
    const lines = await work((message) => spin?.message(`${id}  ${pc.dim(message)}`));
    const block = [pc.bold(id), ...lines].join("\n");
    if (spin) spin.stop(block);
    else ui.info(block);
  } catch (error) {
    if (spin) spin.stop(pc.red(`${id} failed`));
    else ui.info(pc.red(`${id} failed`));
    throw error;
  }
}

interface PushOutcome {
  id: string;
  version: number;
  live: boolean;
}

function summary(outcomes: PushOutcome[], skipped: number, promoted: boolean): void {
  const count = outcomes.length;
  const noun = (n: number) => (n === 1 ? "paywall" : "paywalls");
  const unchanged = skipped > 0 ? ` · ${pc.dim(`${skipped} unchanged`)}` : "";

  if (count === 0) {
    ui.outro(skipped > 0 ? `Nothing to do · ${skipped} unchanged.` : "Nothing to do.");
    return;
  }
  if (promoted) {
    ui.outro(`${pc.green(`${count} ${noun(count)} live`)}${unchanged}.`);
    return;
  }
  ui.outro(
    `${count} ${noun(count)} pushed${unchanged} · run \`superwall promote\` to publish ${count === 1 ? "it" : "them"}.`,
  );
}

interface Prepared {
  surface: FrameworkSurface;
  bind: ResolvedBinding;
  build: Awaited<ReturnType<Framework["buildSnapshot"]>>;
  live?: number;
  changed: boolean;
  pending: boolean;
}

const BUILD_CONCURRENCY = Math.max(2, Math.min(8, cpus().length - 1));

async function prepare(
  context: CommandContext<"required">,
  input: {
    framework: Framework;
    project: FrameworkProject;
    surfaces: FrameworkSurface[];
    interactive: boolean;
    promote: boolean;
  },
): Promise<Prepared[]> {
  const { framework, project, surfaces } = input;

  const applicationId = await resolveApplicationId({
    api: context.api,
    superwallDir: project.superwallDir,
    pickApplication: input.interactive ? pickApplicationOption : undefined,
  });

  const spin = context.outputMode === "rich" ? ui.spinner() : undefined;
  const label = surfaces.length === 1 ? surfaces[0]?.id : `${surfaces.length} paywalls`;
  spin?.start(`Building ${label}`);
  const at = Date.now();
  try {
    const builds = await pooled(surfaces, BUILD_CONCURRENCY, (surface) =>
      framework.buildSnapshot(project, surface, { assetBaseUrl: assetBaseUrl(applicationId) }),
    );

    const projectId = await projectForApplication(context.api, applicationId);
    if (projectId) {
      requireProducts(
        await fetchProducts(context.api, projectId),
        surfaces.map((surface, index) => ({
          id: surface.id,
          products: builds[index]?.products,
        })),
      );
    }

    const bindings: ResolvedBinding[] = [];
    for (const [index, surface] of surfaces.entries()) {
      bindings.push(
        await resolveBinding({
          api: context.api,
          superwallDir: project.superwallDir,
          surface,
          name: builds[index]?.name,
          surfaces: project.surfaces,
          renamesResolved: true,
          pickApplication: input.interactive ? pickApplicationOption : undefined,
        }),
      );
    }

    const prepared = await pooled(surfaces, BUILD_CONCURRENCY, async (surface, index) => {
      const bind = bindings[index];
      const build = builds[index];
      if (!bind || !build) throw new Error(`Missing binding for ${surface.id}`);
      requireAssets(build);
      const live = await livePaywall(context.api, bind.paywallId);
      const lock = readLock(project.superwallDir);
      const section = surface.kind === "paywall" ? lock.paywalls : lock.funnels;
      const pushed = section[surface.id]?.snapshot;
      return {
        surface,
        bind,
        build,
        live: live.version,
        changed: needsWork(build.snapshotId, pushed, live.snapshotId),
        pending: !needsWork(build.snapshotId, pushed, live.snapshotId)
          && live.snapshotId !== build.snapshotId,
      };
    });
    const modified = prepared.filter((entry) => entry.changed).length;
    spin?.stop(
      `${pc.bold(`Built ${label}`)} ${pc.dim(`${modified} modified · ${prepared.length - modified} unchanged`)} ${took(at)}`,
    );
    return prepared;
  } catch (error) {
    spin?.stop(pc.red(`Building ${label} failed`));
    throw error;
  }
}

export async function runPushPipeline(
  context: CommandContext<"required">,
  options: { promote: boolean; load?: (dir: string) => Promise<Framework> },
): Promise<void> {
  const dir = projectDir(context);
  const framework = await (options.load ?? loadFramework)(dir);
  const project = requireProject(framework.discoverProject(dir), dir);
  const installed = frameworkVersion(dir);
  writeProjectTypes(project, await collectProjectProducts(framework, project.root));
  writeProjectScaffold({
    root: project.root,
    superwallDir: project.superwallDir,
    frameworkVersion: installed,
  });
  const surfaces = selectSurfaces(project, context.argv.id);
  requireClean(surfaces);
  const publishNote = resolveNote(context.argv.message);

  ui.intro(`Superwall ${pc.dim(`v${VERSION}`)}`);

  const renames = await resolveRenames({
    superwallDir: project.superwallDir,
    surfaces: project.surfaces,
    declared: parseRenameFlags(context.argv.rename),
    choose: context.interactive ? pickRenameOption : undefined,
    chooseStale: context.interactive ? pickStaleOption : undefined,
    notice: (message) => ui.warn(message),
  });
  for (const pair of renames.renamed) {
    ui.step(`${pair.kind}/${pair.to} keeps paywall ${pair.paywallId} (renamed from ${pair.from})`);
  }
  for (const orphan of renames.dropped) {
    ui.step(
      `${orphan.kind}/${orphan.id} removed from superwall.lock · paywall ${orphan.paywallId} is untouched on Superwall`,
    );
  }

  const source = await collectSourceFiles(project.superwallDir);

  const outcomes: PushOutcome[] = [];
  const external = new Set<string>();

  const prepared = await prepare(context, {
    framework,
    project,
    surfaces,
    interactive: context.interactive,
    promote: options.promote,
  });
  for (const entry of prepared) {
    for (const source of entry.build.externalSources ?? []) external.add(source);
  }
  const changed = prepared.filter((entry) => entry.changed);
  const skipped = prepared.length - changed.length;
  const pending = options.promote ? prepared.filter((entry) => entry.pending) : [];
  const pendingHint = pendingPromoteWarning(pending.map((entry) => entry.surface.id));
  if (pendingHint) ui.warn(pendingHint);

  for (const { surface, bind, build, live: wasLive } of changed) {
    let version = 0;
    let live = false;

    await group(context, surface.id, async (note) => {
      const lines: string[] = [];
      const assets = requireAssets(build);

      lines.push(`${BIND_VERB[bind.source]} paywall ${bind.paywallId}`);
      lines.push(
        assets.length > 0
          ? `Built ${pc.dim(`${kb(build.bytes)} html + ${weight(build.assetBytes ?? 0)} assets`)}`
          : `Built ${pc.dim(`${kb(build.bytes)} · ${build.snapshotId.slice(0, 8)}`)}`,
      );

      note("Syncing assets");
      const synced = await timed(() =>
        syncAssets({ api: context.api, paywallId: bind.paywallId, assets }),
      );
      if (assets.length > 0) {
        const noun = assets.length === 1 ? "asset" : "assets";
        lines.push(
          synced.value.uploaded > 0
            ? `${assets.length} ${noun} ${pc.dim(`(${weight(synced.value.totalBytes)})`)}, ${synced.value.uploaded} uploaded ${synced.took}`
            : `Assets up to date ${pc.dim(`(${assets.length} ${noun})`)} ${synced.took}`,
        );
      }

      note("Pushing");
      const push = await timed(() =>
        pushPaywallVersion(context.api, bind.paywallId, {
          html: build.html,
          surface: surface.id,
          assets: synced.value.assets,
          products: versionProducts(build.products),
        }),
      );
      version = push.value.version;
      writeSnapshot(project.superwallDir, surface.kind, surface.id, build.snapshotId);
      lines.push(
        `${pushedLine({
          version,
          snapshotId: push.value.snapshot_id ?? build.snapshotId,
          live: wasLive,
          promoting: options.promote,
        })} ${push.took}`,
      );

      note("Pushing source");
      const pushed = await timed(() => {
        if (!source.ok) throw new Error(source.reason);
        return pushSource({
          api: context.api,
          paywallId: bind.paywallId,
          applicationId: bind.applicationId,
          version,
          files: source.files,
          framework: installed,
          surface: surface.id,
          kind: surface.kind,
          snapshotId: build.snapshotId,
          cli: VERSION,
          note: publishNote,
          external: [...(build.externalSources ?? [])].sort(),
        });
      });
      const sha = pc.dim(pushed.value.commitSha.slice(0, 7));
      lines.push(
        `Source ${pushed.value.status === "unchanged" ? "unchanged" : "pushed"} ${sha} ${pushed.took}`,
      );

      if (options.promote) {
        note("Promoting");
        const promo = await timed(() =>
          promotePaywallVersion(context.api, bind.paywallId, { version }),
        );
        lines.push(`${transition(wasLive, promo.value.version)} ${promo.took}`);
        live = true;
      }

      return lines;
    });

    outcomes.push({ id: surface.id, version, live });
  }

  warnNotPortable(external);
  summary(outcomes, skipped, options.promote);
}

export { group, timed };
