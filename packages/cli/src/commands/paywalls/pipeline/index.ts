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
import { resolveApps } from "@/core/paywalls/binding/apps";
import { resolveBinding, type ResolvedBinding } from "@/core/paywalls/binding/binding";
import {
  parsePlatformFlags,
  planTargets,
  targetLabel,
  wantedPlatforms,
  type DeclaredPlatforms,
  type SurfaceTarget,
} from "@/core/paywalls/binding/targets";
import { collectProjectDeclarations, writeProjectTypes } from "@/core/paywalls/project/types";
import { describeBindings, readLock, writeSnapshot } from "@/core/paywalls/project/lock";
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
import { VERSION } from "@/environment";
import { ui } from "@/ui";
import {
  BIND_VERB,
  kb,
  pendingPromoteWarning,
  pushedLine,
  resolveNote,
  took,
  transition,
  weight,
} from "./report";
export { LAYOUT_HINT, pushedLine, transition } from "./report";
export {
  needsWork,
  parseIds,
  projectDir,
  projectDirs,
  requireClean,
  requireProject,
  selectSurfaces,
} from "./selection";
export { pendingPromoteWarning } from "./report";
import {
  needsWork,
  parseIds,
  projectDir,
  requireClean,
  requireProject,
  selectSurfaces,
} from "./selection";
import { pickApplicationOption } from "../pick-app";
import { pickRenameOption } from "../pick-rename";
import { pickStaleOption } from "../pick-stale";

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
  target: SurfaceTarget;
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
    declared: DeclaredPlatforms;
    interactive: boolean;
    promote: boolean;
  },
): Promise<{ prepared: Prepared[]; multi: boolean }> {
  const { framework, project, surfaces, declared } = input;

  const apps = await resolveApps({
    api: context.api,
    superwallDir: project.superwallDir,
    wanted: wantedPlatforms(surfaces, declared),
    pickApplication: input.interactive ? pickApplicationOption : undefined,
  });
  const multi = Object.keys(apps).length > 1;
  const targets = planTargets({
    surfaces,
    declared,
    apps,
    only: parsePlatformFlags(context.argv.platform),
  });

  const spin = context.outputMode === "rich" ? ui.spinner() : undefined;
  const label =
    targets.length === 1 && targets[0] !== undefined
      ? targetLabel(targets[0], multi)
      : `${targets.length} paywalls`;
  spin?.start(`Building ${label}`);
  const at = Date.now();
  try {
    const builds = await pooled(targets, BUILD_CONCURRENCY, (target) =>
      framework.buildSnapshot(project, target.surface, {
        assetBaseUrl: assetBaseUrl(target.applicationId),
        platform: target.platform,
      }),
    );

    const projectIds = new Map<string, string | undefined>();
    for (const target of targets) {
      if (projectIds.has(target.applicationId)) continue;
      projectIds.set(
        target.applicationId,
        await projectForApplication(context.api, target.applicationId),
      );
    }
    const catalogues = new Map<string, Record<string, Record<string, unknown>>>();
    for (const projectId of new Set(projectIds.values())) {
      if (projectId === undefined) continue;
      catalogues.set(projectId, await fetchProducts(context.api, projectId));
    }
    for (const [projectId, catalogue] of catalogues) {
      requireProducts(
        catalogue,
        targets.flatMap((target, index) =>
          projectIds.get(target.applicationId) === projectId
            ? [{ id: target.surface.id, products: builds[index]?.products }]
            : [],
        ),
      );
    }

    const bindings: ResolvedBinding[] = [];
    for (const [index, target] of targets.entries()) {
      bindings.push(
        await resolveBinding({
          api: context.api,
          superwallDir: project.superwallDir,
          surface: target.surface,
          app: { platform: target.platform, applicationId: target.applicationId },
          name: builds[index]?.name,
          surfaces: project.surfaces,
          renamesResolved: true,
        }),
      );
    }

    const prepared = await pooled(targets, BUILD_CONCURRENCY, async (target, index) => {
      const bind = bindings[index];
      const build = builds[index];
      if (!bind || !build) throw new Error(`Missing binding for ${target.surface.id}`);
      requireAssets(build);
      const live = await livePaywall(context.api, bind.paywallId);
      const lock = readLock(project.superwallDir);
      const section = target.surface.kind === "paywall" ? lock.paywalls : lock.funnels;
      const pushed = section[target.surface.id]?.[target.platform]?.snapshot;
      return {
        target,
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
    return { prepared, multi };
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
  const declarations = await collectProjectDeclarations(framework, project.root);
  writeProjectTypes(project, declarations.products);
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
    ui.step(
      `${pair.kind}/${pair.to} keeps ${describeBindings(pair.bindings)} (renamed from ${pair.from})`,
    );
  }
  for (const orphan of renames.dropped) {
    ui.step(
      `${orphan.kind}/${orphan.id} removed from superwall.lock · ${describeBindings(orphan.bindings)} untouched on Superwall`,
    );
  }

  const source = await collectSourceFiles(project.superwallDir);

  const outcomes: PushOutcome[] = [];
  const external = new Set<string>();

  const { prepared, multi } = await prepare(context, {
    framework,
    project,
    surfaces,
    declared: declarations.platforms,
    interactive: context.interactive,
    promote: options.promote,
  });
  
  for (const entry of prepared) {
    for (const source of entry.build.externalSources ?? []) external.add(source);
  }
  const changed = prepared.filter((entry) => entry.changed);
  const skipped = prepared.length - changed.length;
  const pending = options.promote ? prepared.filter((entry) => entry.pending) : [];
  const pendingHint = pendingPromoteWarning(
    pending.map((entry) => ({ id: entry.target.surface.id, platform: entry.target.platform })),
    multi,
  );
  if (pendingHint) ui.warn(pendingHint);

  for (const { target, bind, build, live: wasLive } of changed) {
    const { surface } = target;
    let version = 0;
    let live = false;

    await group(context, targetLabel(target, multi), async (note) => {
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
          products: versionProducts(build.products, target.platform),
          settings: build.settings,
          locales: build.locales,
        }),
      );
      version = push.value.version;
      writeSnapshot(
        project.superwallDir,
        surface.kind,
        surface.id,
        target.platform,
        build.snapshotId,
      );
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

    outcomes.push({ id: targetLabel(target, multi), version, live });
  }

  warnNotPortable(external);
  summary(outcomes, skipped, options.promote);
}

export { group, timed };
