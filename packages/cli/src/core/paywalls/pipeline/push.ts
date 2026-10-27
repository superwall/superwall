import { cpus } from "node:os";
import pc from "picocolors";
import type { SuperwallApi } from "@/core/api/client";
import {
  livePaywall,
  platformStore,
  pushedProducts,
  promotePaywallVersion,
  pushPaywallVersion,
  versionProducts,
  type ProductStores,
} from "@/core/api/resources";
import { assetBaseUrl, requireAssets, syncAssets } from "@/core/paywalls/assets";
import { resolveApps } from "@/core/paywalls/binding/apps";
import { resolveBinding, type ResolvedBinding } from "@/core/paywalls/binding/binding";
import { parseRenameFlags, resolveRenames } from "@/core/paywalls/binding/renames";
import {
  parsePlatformFlags,
  planTargets,
  targetLabel,
  wantedPlatforms,
  type DeclaredPlatforms,
  type SurfaceTarget,
} from "@/core/paywalls/binding/targets";
import { pickAdoptOption } from "@/core/paywalls/pickers/adopt";
import { pickApplicationOption } from "@/core/paywalls/pickers/application";
import { pickRenameOption } from "@/core/paywalls/pickers/rename";
import { pickStaleOption } from "@/core/paywalls/pickers/stale";
import {
  listProjectCatalogue,
  projectForApplication,
  requireProducts,
  type ProjectCatalogue,
} from "@/core/paywalls/products";
import {
  frameworkVersion,
  resolveFramework,
  type Framework,
  type FrameworkProject,
  type FrameworkSurface,
} from "@/core/paywalls/project/framework";
import { describeBindings, readLock, writeSnapshot } from "@/core/paywalls/project/lock";
import { writeProjectScaffold } from "@/core/paywalls/project/scaffold";
import { collectProjectDeclarations, writeProjectTypes } from "@/core/paywalls/project/types";
import { warnNotPortable } from "@/core/paywalls/source/portability";
import { collectSourceFiles } from "@/core/paywalls/source/source";
import { assertGit, pushSource } from "@/core/paywalls/source/source-push";
import { VERSION } from "@/environment";
import type { CommandContext } from "@/program/command";
import type { OutputMode } from "@/program/output";
import { requireApi } from "@/core/paywalls/project/session";
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
} from "./output";
import {
  needsWork,
  requireClean,
  requireProject,
  resolveProjectDir,
  selectSurfaces,
  storesDiffer,
} from "./selection";

export interface PushContext {
  api: SuperwallApi;
  interactive: boolean;
  outputMode: OutputMode;
}

export interface PushOptions {
  promote: boolean;
  dir?: string;
  ids?: readonly string[];
  platforms?: readonly string[];
  renames?: readonly string[];
  message?: string;
  overwriteSource?: boolean;
  load?: (dir: string) => Promise<Framework>;
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

export async function timed<T>(work: () => Promise<T>): Promise<{ value: T; took: string }> {
  const at = Date.now();
  const value = await work();
  return { value, took: took(at) };
}

export async function group(
  outputMode: OutputMode,
  id: string,
  work: (note: (message: string) => void) => Promise<string[]>,
): Promise<void> {
  const spin = outputMode === "rich" ? ui.spinner() : undefined;
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
  unsourced?: number;
  stores: ProductStores;
}

const BUILD_CONCURRENCY = Math.max(2, Math.min(8, cpus().length - 1));

async function prepare(
  context: PushContext,
  input: {
    framework: Framework;
    project: FrameworkProject;
    surfaces: FrameworkSurface[];
    declared: DeclaredPlatforms;
    platforms: readonly string[];
  },
): Promise<{ prepared: Prepared[]; multi: boolean }> {
  const { framework, project, surfaces, declared } = input;

  const apps = await resolveApps({
    api: context.api,
    superwallDir: project.superwallDir,
    wanted: wantedPlatforms(surfaces, declared),
    pickApplication: context.interactive ? pickApplicationOption : undefined,
  });
  const multi = Object.keys(apps).length > 1;
  const targets = planTargets({
    surfaces,
    declared,
    apps,
    only: parsePlatformFlags(input.platforms),
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
    const catalogues = new Map<string, ProjectCatalogue>();
    for (const projectId of new Set(projectIds.values())) {
      if (projectId === undefined) continue;
      catalogues.set(projectId, await listProjectCatalogue(context.api, projectId));
    }
    const catalogueOf = (target: SurfaceTarget): ProjectCatalogue | undefined => {
      const projectId = projectIds.get(target.applicationId);
      return projectId === undefined ? undefined : catalogues.get(projectId);
    };

    for (const [projectId, catalogue] of catalogues) {
      requireProducts(
        catalogue.variables,
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
          confirmAdopt: context.interactive ? pickAdoptOption : undefined,
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
      const recorded = section[target.surface.id]?.[target.platform];
      const stores = catalogueOf(target)?.stores ?? {};
      const unsourced =
        recorded?.snapshot === build.snapshotId ? recorded.sourcePending : undefined;
      const stale = needsWork(build.snapshotId, recorded?.snapshot, live.snapshotId);
      const storesChanged =
        !stale &&
        storesDiffer(
          versionProducts(build.products, target.platform, stores),
          await pushedProducts(context.api, bind.paywallId, build.snapshotId),
        );
      const changed = unsourced !== undefined || stale || storesChanged;
      return {
        target,
        bind,
        build,
        live: live.version,
        changed,
        pending: !changed && live.snapshotId !== build.snapshotId,
        unsourced: storesChanged ? undefined : unsourced,
        stores,
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

async function pushVersion(
  context: PushContext,
  input: {
    target: SurfaceTarget;
    bind: ResolvedBinding;
    build: Prepared["build"];
    stores: ProductStores;
    wasLive?: number;
    promoting: boolean;
  },
  lines: string[],
  note: (message: string) => void,
): Promise<number> {
  const { target, bind, build } = input;
  const assets = requireAssets(build);
  lines.push(
    assets.length > 0
      ? `Built ${pc.dim(`${kb(build.bytes)} html + ${weight(build.assetBytes ?? 0)} assets`)}`
      : `Built ${pc.dim(`${kb(build.bytes)} · ${build.snapshotId.slice(0, 8)}`)}`,
  );

  note("Syncing assets");
  const synced = await timed(() => syncAssets({ api: context.api, paywallId: bind.paywallId, assets }));
  if (assets.length > 0) {
    const noun = assets.length === 1 ? "asset" : "assets";
    lines.push(
      synced.value.uploaded > 0
        ? `${assets.length} ${noun} ${pc.dim(`(${weight(synced.value.totalBytes)})`)}, ${synced.value.uploaded} uploaded ${synced.took}`
        : `Assets up to date ${pc.dim(`(${assets.length} ${noun})`)} ${synced.took}`,
    );
  }

  const products = versionProducts(build.products, target.platform, input.stores);
  const elsewhere = products.filter((product) => product.store !== platformStore(target.platform));
  if (elsewhere.length > 0) {
    lines.push(
      `Products ${pc.dim(elsewhere.map((product) => `${product.reference_name} → ${product.store}`).join(", "))}`,
    );
  }

  note("Pushing");
  const push = await timed(() =>
    pushPaywallVersion(context.api, bind.paywallId, {
      html: build.html,
      surface: target.surface.id,
      assets: synced.value.assets,
      products,
      settings: build.settings,
      locales: build.locales,
    }),
  );
  lines.push(
    `${pushedLine({
      version: push.value.version,
      snapshotId: push.value.snapshot_id ?? build.snapshotId,
      live: input.wasLive,
      promoting: input.promoting,
    })} ${push.took}`,
  );
  return push.value.version;
}

export async function runPushPipeline(context: PushContext, options: PushOptions): Promise<void> {
  const dir = resolveProjectDir(options.dir);
  const framework = await (options.load ?? resolveFramework)(dir);
  const project = requireProject(framework.discoverProject(dir), dir);
  const installed = frameworkVersion(dir);
  const declarations = await collectProjectDeclarations(framework, project.root);
  writeProjectTypes(project, declarations.products);
  writeProjectScaffold({
    root: project.root,
    superwallDir: project.superwallDir,
    frameworkVersion: installed,
  });
  const surfaces = selectSurfaces(project, options.ids ?? []);
  requireClean(surfaces);
  const publishNote = resolveNote(options.message);

  ui.intro(`Superwall ${pc.dim(`v${VERSION}`)}`);

  const renames = await resolveRenames({
    superwallDir: project.superwallDir,
    surfaces: project.surfaces,
    declared: parseRenameFlags(options.renames ?? []),
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
    platforms: options.platforms ?? [],
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

  if (changed.length > 0) {
    if (!source.ok) throw new Error(source.reason);
    await assertGit();
  }
  const files = source.ok ? source.files : [];

  for (const { target, bind, build, live: wasLive, unsourced, stores } of changed) {
    const { surface } = target;
    let version = 0;
    let live = false;

    await group(context.outputMode, targetLabel(target, multi), async (note) => {
      const lines: string[] = [`${BIND_VERB[bind.source]} paywall ${bind.paywallId}`];
      if (unsourced === undefined) {
        version = await pushVersion(
          context,
          { target, bind, build, stores, wasLive, promoting: options.promote },
          lines,
          note,
        );
        writeSnapshot(project.superwallDir, surface.kind, surface.id, target.platform, {
          snapshot: build.snapshotId,
          sourcePending: version,
        });
      } else {
        version = unsourced;
        lines.push(`Finishing version ${version} ${pc.dim("(its source never landed)")}`);
      }

      note("Pushing source");
      const pushed = await timed(() =>
        pushSource({
          api: context.api,
          superwallDir: project.superwallDir,
          paywallId: bind.paywallId,
          applicationId: bind.applicationId,
          version,
          files,
          framework: installed,
          surface: surface.id,
          kind: surface.kind,
          snapshotId: build.snapshotId,
          cli: VERSION,
          note: publishNote,
          external: [...(build.externalSources ?? [])].sort(),
          overwrite: options.overwriteSource,
        }),
      );
      writeSnapshot(project.superwallDir, surface.kind, surface.id, target.platform, {
        snapshot: build.snapshotId,
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

interface PushInput {
  args: { dir: string | undefined };
  flags: { id: string[]; platform: string[]; rename: string[]; message: string | undefined; overwriteSource: boolean };
}

export async function runPush(ctx: CommandContext, { args, flags }: PushInput, promote: boolean): Promise<void> {
  const api = await requireApi(ctx.interactive);
  await runPushPipeline(
    { api, interactive: ctx.interactive, outputMode: ctx.outputMode },
    {
      promote,
      dir: args.dir,
      ids: flags.id,
      platforms: flags.platform,
      renames: flags.rename,
      message: flags.message,
      overwriteSource: flags.overwriteSource,
    },
  );
}
