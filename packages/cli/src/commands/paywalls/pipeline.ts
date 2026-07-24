import { resolve } from "node:path";
import pc from "picocolors";
import type { CommandContext } from "@/command";
import { promotePaywallVersion, pushPaywallVersion } from "@/core/api/resources";
import { resolveBinding } from "@/core/paywalls/binding";
import {
  loadFramework,
  type FrameworkProject,
  type FrameworkSurface,
} from "@/core/paywalls/framework";
import { VERSION } from "@/constants";
import { ui } from "@/ui";
import { pickApplicationOption } from "./pick-app";

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} kB`;

export const LAYOUT_HINT = "expected superwall/{paywalls,funnels}/<id>/app/page.tsx";

export function projectDir(context: CommandContext): string {
  return typeof context.argv.dir === "string" ? resolve(context.argv.dir) : process.cwd();
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

const took = (since: number): string => {
  const seconds = (Date.now() - since) / 1000;
  return pc.dim(seconds < 10 ? `(${seconds.toFixed(1)}s)` : `(${Math.round(seconds)}s)`);
};

async function timed<T>(work: () => Promise<T>): Promise<{ value: T; took: string }> {
  const at = Date.now();
  const value = await work();
  return { value, took: took(at) };
}

/**
 * Runs one paywall as a single subtree: a live spinner while it works, then
 * its own `◇ <name>` heading with the steps indented beneath — so three
 * paywalls read as three groups, not a flat wall of lines.
 */
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
    ui.outro(`${count} ${noun} pushed · run \`superwall promote\` to make ${count === 1 ? "it" : "them"} live.`);
  }
}

export async function runPushPipeline(
  context: CommandContext<"required">,
  options: { promote: boolean },
): Promise<void> {
  const dir = projectDir(context);
  const framework = await loadFramework(dir);
  const project = framework.discoverProject(dir);
  const surfaces = selectSurfaces(project, context.argv.only);

  ui.intro(`Superwall ${pc.dim(`v${VERSION}`)}`);

  const outcomes: PushOutcome[] = [];

  for (const surface of surfaces) {
    let version = 0;
    let live = false;

    await group(context, surface.id, async (note) => {
      const lines: string[] = [];

      note("building");
      const build = await timed(() => framework.buildSurface(project, surface));
      lines.push(`Built ${pc.dim(`${kb(build.value.bytes)} · ${build.value.snapshotId.slice(0, 8)}`)} ${build.took}`);

      note("finding on Superwall");
      const bind = await timed(() =>
        resolveBinding({
          api: context.api,
          superwallDir: project.superwallDir,
          surface,
          pickApplication: context.interactive ? pickApplicationOption : undefined,
        }),
      );
      lines.push(
        `${bind.value.source === "created" ? "Created" : "Linked to"} paywall ${bind.value.paywallId} ${bind.took}`,
      );

      note("pushing");
      const push = await timed(() =>
        pushPaywallVersion(context.api, bind.value.paywallId, {
          html: build.value.html,
          surface: surface.id,
        }),
      );
      version = push.value.version;

      if (options.promote) {
        lines.push(`Pushed version ${version} ${push.took}`);
        note("promoting");
        const promo = await timed(() =>
          promotePaywallVersion(context.api, bind.value.paywallId, { version }),
        );
        lines.push(`Promoted ${pc.green(`version ${version}`)} ${promo.took}`);
        live = true;
      } else {
        lines.push(`Pushed ${pc.yellow(`version ${version}`)} ${push.took}`);
      }

      return lines;
    });

    outcomes.push({ id: surface.id, version, live });
  }

  summary(outcomes, options.promote);
}

export { group, timed };
