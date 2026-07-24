import pc from "picocolors";
import { defineCommand } from "@/command";
import { loadFramework } from "@/core/paywalls/framework";
import { ui } from "@/ui";
import { LAYOUT_HINT, projectDir } from "./paywalls/pipeline";

export const runDev = defineCommand({
  name: "dev",
  output: "human",
  async run(context) {
    const dir = projectDir(context);
    const framework = await loadFramework(dir);
    const project = framework.discoverProject(dir);

    // Defaults live in the yargs definition (cli.ts) — these narrow only.
    const requestedPort = Number(context.argv.port);
    const host = String(context.argv.host);
    const runtimeUrl = process.env.SUPERWALL_RUNTIME_URL?.replace(/\/+$/, "");

    const server = await framework.startPreviewServer(project.root, {
      port: requestedPort,
      host,
      // Absent, the framework serves previews under the production
      // live.css — matching Superwall with no configuration.
      platformStylesheet: runtimeUrl ? `${runtimeUrl}/live.css` : undefined,
    });
    const url = server.resolvedUrls?.local[0] ?? `http://localhost:${requestedPort}/`;
    const actualPort = Number(new URL(url).port);

    ui.info("");
    ui.info(`  ${pc.bold("superwall")} ${pc.dim("studio")}  ${pc.green(url)}`);
    if (actualPort !== requestedPort) {
      ui.info(pc.dim(`  port ${requestedPort} was in use — moved to ${actualPort}`));
    }
    ui.info("");
    for (const surface of project.surfaces) {
      ui.info(
        `  ${pc.green("➜")} ${pc.bold(`${surface.kind}/${surface.id}`)} ${pc.dim(
          `${url}${surface.kind}/${surface.id}`,
        )}`,
      );
    }
    for (const diagnostic of project.diagnostics) {
      ui.info(`  ${pc.yellow("▲")} ${diagnostic}`);
    }
    if (project.surfaces.length === 0) {
      ui.info(`  ${pc.yellow("▲")} nothing to preview — ${LAYOUT_HINT}`);
    }
    ui.info("");
  },
});
