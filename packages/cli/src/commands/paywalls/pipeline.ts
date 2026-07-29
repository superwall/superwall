import { resolve } from "node:path";
import pc from "picocolors";
import type { CommandContext } from "@/command";
import {
  livePaywallVersion,
  promotePaywallVersion,
  pushPaywallVersion,
} from "@/core/api/resources";
import { assetBaseUrl, requireAssets, syncAssets } from "@/core/paywalls/assets";
import { resolveBinding, type ResolvedBinding } from "@/core/paywalls/binding/binding";
import { writeEnvTypes } from "@/core/paywalls/project/env";
import {
  frameworkVersion,
  loadFramework,
  type Framework,
  type FrameworkProject,
  type FrameworkSurface,
} from "@/core/paywalls/project/framework";
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
  "expected superwall/{paywalls,funnels}/<id>/ with config.ts and app/page.tsx";

export function projectDir(context: CommandContext): string {
  return typeof context.argv.dir === "string" ? resolve(context.argv.dir) : process.cwd();
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

export function selectSurfaces(project: FrameworkProject, only: unknown): FrameworkSurface[] {
  const filter = typeof only === "string" ? only : undefined;
  const selected = project.surfaces.filter((surface) => !filter || surface.id === filter);
  if (selected.length === 0) {
    const known = project.surfaces.map((surface) => surface.id).join(", ");
    throw new Error(
      filter
        ? `No paywall or funnel named "${filter}"` +
          (known ? ` — this project has: ${known}.` : ` — ${LAYOUT_HINT}.`)
        : `No paywalls or funnels found — ${LAYOUT_HINT}.`,
    );
  }
  return selected;
}

const NOTE_LIMIT = 2000;

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

function summary(outcomes: PushOutcome[], promoted: boolean): void {
  if (outcomes.length === 0) return;
  const count = outcomes.length;
  const noun = count === 1 ? "paywall" : "paywalls";

  if (promoted) {
    ui.outro(pc.green(`${count} ${noun} live.`));
  } else {
    ui.outro(
      `${count} ${noun} pushed · run \`superwall promote\` to publish ${count === 1 ? "it" : "them"}.`,
    );
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
  writeEnvTypes(project.superwallDir);
  writeProjectScaffold({
    root: project.root,
    superwallDir: project.superwallDir,
    frameworkVersion: installed,
  });
  const surfaces = selectSurfaces(project, context.argv.only);
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

  for (const surface of surfaces) {
    let version = 0;
    let live = false;

    await group(context, surface.id, async (note) => {
      const lines: string[] = [];

      note("Finding on Superwall");
      const bind = await timed(() =>
        resolveBinding({
          api: context.api,
          superwallDir: project.superwallDir,
          surface,
          surfaces: project.surfaces,
          renamesResolved: true,
          pickApplication: context.interactive ? pickApplicationOption : undefined,
        }),
      );
      lines.push(
        `${BIND_VERB[bind.value.source]} paywall ${bind.value.paywallId} ${bind.took}`,
      );

      note("Building");
      const build = await timed(() =>
        framework.buildSnapshot(project, surface, {
          assetBaseUrl: assetBaseUrl(bind.value.applicationId),
        }),
      );
      const assets = requireAssets(build.value);
      for (const entry of build.value.externalSources ?? []) external.add(entry);
      lines.push(
        assets.length > 0
          ? `Built ${pc.dim(`${kb(build.value.bytes)} html + ${weight(build.value.assetBytes ?? 0)} assets`)} ${build.took}`
          : `Built ${pc.dim(`${kb(build.value.bytes)} · ${build.value.snapshotId.slice(0, 8)}`)} ${build.took}`,
      );

      note("Syncing assets");
      const synced = await timed(() =>
        syncAssets({ api: context.api, paywallId: bind.value.paywallId, assets }),
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
      const wasLive = await livePaywallVersion(context.api, bind.value.paywallId);
      const push = await timed(() =>
        pushPaywallVersion(context.api, bind.value.paywallId, {
          html: build.value.html,
          surface: surface.id,
          assets: synced.value.assets,
        }),
      );
      version = push.value.version;
      lines.push(
        `${pushedLine({
          version,
          snapshotId: push.value.snapshot_id ?? build.value.snapshotId,
          live: wasLive,
          promoting: options.promote,
        })} ${push.took}`,
      );

      note("Pushing source");
      const pushed = await timed(() => {
        if (!source.ok) throw new Error(source.reason);
        return pushSource({
          api: context.api,
          paywallId: bind.value.paywallId,
          applicationId: bind.value.applicationId,
          version,
          files: source.files,
          framework: installed,
          surface: surface.id,
          kind: surface.kind,
          snapshotId: build.value.snapshotId,
          cli: VERSION,
          note: publishNote,
          external: [...(build.value.externalSources ?? [])].sort(),
        });
      });
      const sha = pc.dim(pushed.value.commitSha.slice(0, 7));
      lines.push(
        `Source ${pushed.value.status === "unchanged" ? "unchanged" : "pushed"} ${sha} ${pushed.took}`,
      );

      if (options.promote) {
        note("Promoting");
        const promo = await timed(() =>
          promotePaywallVersion(context.api, bind.value.paywallId, { version }),
        );
        lines.push(`${transition(wasLive, promo.value.version)} ${promo.took}`);
        live = true;
      }

      return lines;
    });

    outcomes.push({ id: surface.id, version, live });
  }

  warnNotPortable(external);
  summary(outcomes, options.promote);
}

export { group, timed };
