import pc from "picocolors";
import { defineCommand } from "@/command";
import { VERSION } from "@/constants";
import { ApiError } from "@/core/api/client";
import { livePaywallVersion, promotePaywallVersion } from "@/core/api/resources";
import { resolveBinding } from "@/core/paywalls/binding/binding";
import { loadFramework } from "@/core/paywalls/project/framework";
import { requireApi } from "@/core/paywalls/project/session";
import { ui } from "@/ui";
import { pickApplicationOption } from "./paywalls/pick-app";
import { group, projectDir, selectSurfaces, timed, transition } from "./paywalls/pipeline";

export const runPromote = defineCommand({
  name: "promote",
  output: "human",
  async run(context) {
    const api = await requireApi(context.interactive);
    const dir = projectDir(context);
    const framework = await loadFramework(dir);
    const project = framework.discoverProject(dir);
    const surfaces = selectSurfaces(project, context.argv.id);

    const requested = context.argv.version;
    if (requested !== undefined && !Number.isInteger(requested)) {
      throw new Error("--version takes a pushed version number, e.g. --version 3.");
    }
    const version = typeof requested === "number" ? requested : undefined;
    if (requested !== undefined && surfaces.length > 1) {
      throw new Error("--version targets one surface — combine it with a single --id <id>.");
    }

    ui.intro(`Superwall ${pc.dim(`v${VERSION}`)}`);

    let promoted = 0;
    let skipped = 0;
    for (const surface of surfaces) {
      let changed = true;
      await group(context, surface.id, async (note) => {
        note("Finding on Superwall");
        const binding = await resolveBinding({
          api,
          superwallDir: project.superwallDir,
          surface,
          surfaces: project.surfaces,
          pickApplication: context.interactive ? pickApplicationOption : undefined,
          create: false,
        });

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
  },
});
