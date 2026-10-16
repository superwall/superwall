import pc from "picocolors";
import { renderUnicodeCompact } from "uqr";
import { defineCommand } from "@/command";
import { VERSION } from "@/environment";
import { collectProjectDeclarations, writeProjectTypes } from "@/core/paywalls/project/types";
import { frameworkVersion, loadFramework } from "@/core/paywalls/project/framework";
import { writeProjectScaffold } from "@/core/paywalls/project/scaffold";
import * as path from "node:path";
import { allowLocalNetworking } from "@/core/paywalls/project/scheme";
import { openBrowser } from "@/core/auth/browser";
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
      writeProjectTypes(project, (await collectProjectDeclarations(framework, project.root)).products);
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
    const studio = createStudioActions(framework, project);

    const server = await framework.startPreviewServer(
      projects.map((one) => one.root),
      {
        port: requestedPort,
        host,
        platformStylesheet: runtimeUrl ? `${runtimeUrl}/live.css` : undefined,
        studio,
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
    if (typeof context.argv.open === "string" && context.argv.open !== "") {
      const target = `${url}${context.argv.open.replace(/^\//, "")}`;
      void openBrowser(target).then((opened) => {
        if (!opened) ui.warn(`Couldn't open a browser here. Open ${target} yourself.`);
      });
    }

    const network = server.resolvedUrls?.network[0];
    if (network) {
      const deviceUrl = `${network}device`;
      ui.step(
        [
          `Device ${pc.green(deviceUrl)}`,
          pc.dim("Scan on a phone on the same wifi to preview on device:"),
          "",
          ...renderUnicodeCompact(deviceUrl).split("\n"),
        ].join("\n"),
      );
    }

    const scheme = await studio.appScheme?.().catch(() => undefined);
    const plist = scheme?.blocksLocalNetworking;
    if (plist !== undefined) {
      ui.warn(
        "This app can't load paywalls from the dev server: App Transport Security blocks plain http.",
      );
      const allowed = context.interactive
        ? await ui.confirm({
            message: `Allow local previewing in ${path.basename(plist)}? Development builds only.`,
            initial: true,
          })
        : null;

      if (allowed === true) {
        try {
          await allowLocalNetworking(plist);
          ui.step(`Local previewing allowed in ${plist} — rebuild the app to pick it up.`);
        } catch (error) {
          ui.warn(`Could not edit ${plist}: ${error instanceof Error ? error.message : error}`);
        }
      } else {
        ui.warn(
          `Add to ${plist}, in your Debug configuration only:\n` +
            "  NSAppTransportSecurity → NSAllowsLocalNetworking = YES\n" +
            "                         → NSAllowsArbitraryLoadsInWebContent = YES",
        );
      }
    }

    for (const diagnostic of projects.flatMap((one) => one.diagnostics)) {
      ui.warn(diagnostic);
    }
    if (projects.every((one) => one.surfaces.length === 0)) {
      ui.warn(`Nothing to preview — ${LAYOUT_HINT}.`);
    }
  },
});
