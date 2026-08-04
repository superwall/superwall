import pc from "picocolors";
import { defineCommand } from "@/command";
import { VERSION } from "@/constants";
import { collectProjectProducts, writeProjectTypes } from "@/core/paywalls/project/types";
import { frameworkVersion, loadFramework } from "@/core/paywalls/project/framework";
import { writeProjectScaffold } from "@/core/paywalls/project/scaffold";
import { createStudioActions } from "./studio-actions";
import { ui } from "@/ui";
import { LAYOUT_HINT, projectDir, projectDirs, requireProject } from "./pipeline";

export const runDev = defineCommand({
  name: "dev",
  output: "human",
  async run(context) {
    const dirs = projectDirs(context);
    const dir = projectDir(context);
    const framework = await loadFramework(dir);

    const projects =
      dirs.length === 1
        ? [requireProject(framework.discoverProject(dirs[0] as string), dirs[0] as string)]
        : dirs.map((one) => framework.discoverProject(one)).filter((one) => Boolean(one.marker));

    if (projects.length === 0) {
      throw new Error(
        `No superwall projects found in ${dirs.length} ${dirs.length === 1 ? "directory" : "directories"}.\n` +
          "Expected a package.json in each (or in superwall/) that depends on superwall.",
      );
    }
    for (const project of projects) {
      writeProjectTypes(project, await collectProjectProducts(framework, project.root));
      writeProjectScaffold({
        root: project.root,
        superwallDir: project.superwallDir,
        frameworkVersion: frameworkVersion(dir),
      });
    }
    const project = projects[0];
    if (!project) throw new Error("No project directories given.");

    const requestedPort = Number(context.argv.port);
    const host = String(context.argv.host);
    const runtimeUrl = process.env.SUPERWALL_RUNTIME_URL?.replace(/\/+$/, "");

    const server = await framework.startPreviewServer(
      projects.map((one) => one.root),
      {
        port: requestedPort,
        host,
        platformStylesheet: runtimeUrl ? `${runtimeUrl}/live.css` : undefined,
        studio: createStudioActions(framework, project),
      },
    );
    const url = server.resolvedUrls?.local[0] ?? `http://localhost:${requestedPort}/`;
    const actualPort = Number(new URL(url).port);

    ui.intro(`Superwall ${pc.dim(`v${VERSION}`)}`);

    if (actualPort !== requestedPort) {
      ui.warn(`Port ${requestedPort} was in use — moved to ${actualPort}.`);
    }

    const many = projects.length > 1;
    const slug = (root: string) => root.split("/").filter(Boolean).at(-1) ?? "";
    const rows = projects.flatMap((one) => {
      const prefix = many ? `${slug(one.root)}/` : "";
      const heading = many ? [pc.bold(slug(one.root))] : [];
      return [
        ...heading,
        ...one.surfaces.map(
          (surface) =>
            `${many ? "  " : ""}${surface.kind}/${pc.bold(surface.id)}  ` +
            pc.dim(`${url}${prefix}${surface.kind}/${surface.id}`),
        ),
      ];
    });
    ui.step([`Studio ${pc.green(url)}`, ...rows].join("\n"));

    for (const diagnostic of projects.flatMap((one) => one.diagnostics)) {
      ui.warn(diagnostic);
    }
    if (projects.every((one) => one.surfaces.length === 0)) {
      ui.warn(`Nothing to preview — ${LAYOUT_HINT}.`);
    }
  },
});
