import pc from "picocolors";
import type { CommandContext } from "@/program/command";
import { ApiError } from "@/core/api/client";
import { livePaywallVersion, promotePaywallVersion } from "@/core/api/resources";
import { resolveApps } from "@/core/paywalls/binding/apps";
import { resolveBinding } from "@/core/paywalls/binding/binding";
import {
  parsePlatformFlags,
  planTargets,
  targetLabel,
  wantedPlatforms,
  type SurfaceTarget,
} from "@/core/paywalls/binding/targets";
import { pickAdoptOption } from "@/core/paywalls/pickers/adopt";
import { pickApplicationOption } from "@/core/paywalls/pickers/application";
import { group, timed } from "@/core/paywalls/pipeline/push";
import { transition } from "@/core/paywalls/pipeline/output";
import { resolveProjectDir, selectSurfaces } from "@/core/paywalls/pipeline/selection";
import { resolveFramework } from "@/core/paywalls/project/framework";
import { readLock, type LockFile } from "@/core/paywalls/project/lock";
import { requireApi } from "@/core/paywalls/project/session";
import { collectProjectDeclarations } from "@/core/paywalls/project/types";
import { VERSION } from "@/environment";
import { ui } from "@/ui";

interface PromoteInput {
  args: { dir: string | undefined; };
  flags: { id: string[]; platform: string[]; version: number | undefined; };
}

export function assertSourced(lock: LockFile, target: SurfaceTarget, version: number | undefined): void {
  const section = target.surface.kind === "paywall" ? lock.paywalls : lock.funnels;
  const pending = section[target.surface.id]?.[target.platform]?.sourcePending;
  if (pending === undefined || (version !== undefined && version !== pending)) return;
  throw new Error(
    `${target.surface.id} version ${pending} has no source yet — run \`superwall push\` to finish it, then promote.`,
  );
}

export async function runPromote(ctx: CommandContext<"none">, { args, flags }: PromoteInput): Promise<void> {
  const api = await requireApi(ctx.interactive);
  const dir = resolveProjectDir(args.dir);
  const framework = await resolveFramework(dir);
  const project = framework.discoverProject(dir);
  const surfaces = selectSurfaces(project, flags.id);
  const declared = (await collectProjectDeclarations(framework, project.root)).platforms;

  const version = flags.version;
  if (version !== undefined && !Number.isInteger(version)) {
    throw new Error("--version takes a pushed version number, e.g. --version 3.");
  }
  if (version !== undefined && surfaces.length > 1) {
    throw new Error("--version targets one surface — combine it with a single --id <id>.");
  }

  ui.intro(`Superwall ${pc.dim(`v${VERSION}`)}`);

  const apps = await resolveApps({
    api,
    superwallDir: project.superwallDir,
    wanted: wantedPlatforms(surfaces, declared),
    pickApplication: ctx.interactive ? pickApplicationOption : undefined,
  });
  const multi = Object.keys(apps).length > 1;
  const targets = planTargets({
    surfaces,
    declared,
    apps,
    only: parsePlatformFlags(flags.platform),
  });

  if (version !== undefined && targets.length > 1) {
    throw new Error(
      `--version targets one paywall — \`${surfaces[0]?.id}\` is pushed to ${targets
        .map((target) => target.platform)
        .join(", ")}; add --platform <platform> to pick one.`,
    );
  }

  let promoted = 0;
  let skipped = 0;

  for (const target of targets) {
    let changed = true;
    await group(ctx.outputMode, targetLabel(target, multi), async (note) => {
      note("Finding on Superwall");
      const binding = await resolveBinding({
        api,
        superwallDir: project.superwallDir,
        surface: target.surface,
        app: { platform: target.platform, applicationId: target.applicationId },
        surfaces: project.surfaces,
        create: false,
        confirmAdopt: ctx.interactive ? pickAdoptOption : undefined,
      });

      assertSourced(readLock(project.superwallDir), target, version);
      note("Promoting");
      const before = await livePaywallVersion(api, binding.paywallId);
      const promo = await timed(() =>
        promotePaywallVersion(api, binding.paywallId, { version }).catch((error: unknown) => {
          if (error instanceof ApiError && error.status === 404 && version !== undefined) {
            error.hint = "Run `superwall promote` without --version to promote the latest.";
          }
          throw error;
        }),
      );
      changed = before !== promo.value.version;
      return [`${transition(before, promo.value.version)} ${promo.took}`];
    });
    if (changed) promoted += 1;
    else skipped += 1;
  }

  const noun = (n: number) => (n === 1 ? "paywall" : "paywalls");
  const unchanged = skipped > 0 ? ` · ${pc.dim(`${skipped} already live`)}` : "";
  ui.outro(
    promoted > 0
      ? `${pc.green(`${promoted} ${noun(promoted)} live`)}${unchanged}.`
      : `Nothing to do · ${skipped} already live.`,
  );
}
