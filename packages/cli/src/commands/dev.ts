import pc from "picocolors";
import { defineCommand } from "@/command";
import { VERSION } from "@/constants";
import { loadFramework } from "@/core/paywalls/framework";
import { createStudioActions } from "./paywalls/studio-actions";
import { ui } from "@/ui";
import { LAYOUT_HINT, projectDir } from "./paywalls/pipeline";

export const runDev = defineCommand({
  name: "dev",
  output: "human",
  async run(context) {
    const dir = projectDir(context);
    const framework = await loadFramework(dir);
    const project = framework.discoverProject(dir);

    const requestedPort = Number(context.argv.port);
    const host = String(context.argv.host);
    const runtimeUrl = process.env.SUPERWALL_RUNTIME_URL?.replace(/\/+$/, "");

    const server = await framework.startPreviewServer(project.root, {
      port: requestedPort,
      host,
      platformStylesheet: runtimeUrl ? `${runtimeUrl}/live.css` : undefined,
      studio: createStudioActions(framework, project),
    });
    const url = server.resolvedUrls?.local[0] ?? `http://localhost:${requestedPort}/`;
    const actualPort = Number(new URL(url).port);

    ui.intro(`Superwall ${pc.dim(`v${VERSION}`)}`);

    if (actualPort !== requestedPort) {
      ui.warn(`Port ${requestedPort} was in use — moved to ${actualPort}.`);
    }

    const rows = project.surfaces.map(
      (surface) =>
        `${surface.kind}/${pc.bold(surface.id)}  ${pc.dim(`${url}${surface.kind}/${surface.id}`)}`,
    );
    ui.step([`Studio ${pc.green(url)}`, ...rows].join("\n"));

    for (const diagnostic of project.diagnostics) {
      ui.warn(diagnostic);
    }
    if (project.surfaces.length === 0) {
      ui.warn(`Nothing to preview — ${LAYOUT_HINT}.`);
    }
  },
});
