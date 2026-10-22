import * as path from "node:path";
import pc from "picocolors";
import { renderUnicodeCompact } from "uqr";
import { openBrowser } from "@/core/account/browser";
import { frameworkVersion, resolveFramework } from "@/core/paywalls/project/framework";
import { writeProjectScaffold } from "@/core/paywalls/project/scaffold";
import { allowLocalNetworking } from "@/core/paywalls/project/scheme";
import { collectProjectDeclarations, writeProjectTypes } from "@/core/paywalls/project/types";
import { VERSION } from "@/environment";
import { ui } from "@/ui";
import { LAYOUT_HINT } from "../pipeline/output";
import { requireProject, resolveProjectDirs } from "../pipeline/selection";
import { createStudioActions } from "./actions";

interface StudioInput {
  dirs: readonly string[];
  port: number;
  host: string;
  open?: string;
  interactive: boolean;
}

export interface StudioDeps {
  openBrowser?: (url: string) => Promise<boolean>;
  allowLocalNetworking?: (plist: string) => Promise<void>;
}

export async function runStudio(input: StudioInput, deps: StudioDeps = {}): Promise<void> {
  const dirs = resolveProjectDirs(input.dirs);
  const dir = dirs[0] ?? process.cwd();
  const framework = await resolveFramework(dir);

  const projects =
    dirs.length === 1
      ? [requireProject(framework.discoverProject(dir), dir)]
      : dirs.map((one) => framework.discoverProject(one)).filter((one) => Boolean(one.marker));

  const project = projects[0];
  if (!project) {
    throw new Error(
      `No superwall projects found in ${dirs.length} directories.\n` +
        "Expected a package.json in each (or in superwall/) that depends on superwall.",
    );
  }
  for (const one of projects) {
    writeProjectTypes(one, (await collectProjectDeclarations(framework, one.root)).products);
    writeProjectScaffold({
      root: one.root,
      superwallDir: one.superwallDir,
      frameworkVersion: frameworkVersion(dir),
    });
  }

  const requestedPort = input.port;
  const runtimeUrl = process.env.SUPERWALL_RUNTIME_URL?.replace(/\/+$/, "");
  const studio = createStudioActions(framework, project);

  const server = await framework.startPreviewServer(
    projects.map((one) => one.root),
    {
      port: requestedPort,
      host: input.host,
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
  const rows = projects.flatMap((one) => {
    const prefix = many ? `${path.basename(one.root)}/` : "";
    const heading = many ? [pc.bold(path.basename(one.root))] : [];
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
  if (input.open !== undefined && input.open !== "") {
    const target = `${url}${input.open.replace(/^\//, "")}`;
    void (deps.openBrowser ?? openBrowser)(target).then((opened) => {
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
    ui.warn("This app can't load paywalls from the dev server: App Transport Security blocks plain http.");
    const allowed = input.interactive
      ? await ui.confirm({
          message: `Allow local previewing in ${path.basename(plist)}? Development builds only.`,
          initial: true,
        })
      : null;

    if (allowed === true) {
      try {
        await (deps.allowLocalNetworking ?? allowLocalNetworking)(plist);
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
}
