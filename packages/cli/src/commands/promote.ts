import pc from "picocolors";
import { defineCommand } from "@/command";
import { VERSION } from "@/constants";
import { promotePaywallVersion } from "@/core/api/resources";
import { resolveBinding } from "@/core/paywalls/binding";
import { loadFramework } from "@/core/paywalls/framework";
import { requireApi } from "@/core/paywalls/session";
import { ui } from "@/ui";
import { pickApplicationOption } from "./paywalls/pick-app";
import { group, projectDir, selectSurfaces, timed } from "./paywalls/pipeline";

export const runPromote = defineCommand({
  name: "promote",
  output: "human",
  async run(context) {
    const api = await requireApi(context.interactive);
    const dir = projectDir(context);
    const framework = await loadFramework(dir);
    const project = framework.discoverProject(dir);
    const surfaces = selectSurfaces(project, context.argv.only);

    const requested = context.argv.version;
    if (requested !== undefined && !Number.isInteger(requested)) {
      throw new Error("--version takes a pushed version number, e.g. --version 3.");
    }
    const version = typeof requested === "number" ? requested : undefined;
    if (requested !== undefined && surfaces.length > 1) {
      throw new Error("--version targets one surface — combine it with --only <id>.");
    }

    ui.intro(`Superwall ${pc.dim(`v${VERSION}`)}`);

    for (const surface of surfaces) {
      await group(context, surface.id, async (note) => {
        note("finding on Superwall");
        const binding = await resolveBinding({
          api,
          superwallDir: project.superwallDir,
          surface,
          pickApplication: context.interactive ? pickApplicationOption : undefined,
          create: false,
        });

        note("promoting");
        const promo = await timed(() =>
          promotePaywallVersion(api, binding.paywallId, { version }),
        );
        return [`Promoted ${pc.green(`version ${promo.value.version}`)} ${promo.took}`];
      });
    }

    const noun = surfaces.length === 1 ? "paywall" : "paywalls";
    ui.outro(pc.green(`${surfaces.length} ${noun} live.`));
  },
});
