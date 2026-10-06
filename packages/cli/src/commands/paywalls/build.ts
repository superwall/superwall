import * as fs from "node:fs";
import * as path from "node:path";
import pc from "picocolors";
import { defineCommand, type CommandContext } from "@/command";
import { VERSION } from "@/environment";
import { assetBaseUrl } from "@/core/paywalls/assets";
import {
  loadFramework,
  type Framework,
  type FrameworkProject,
  type FrameworkSurface,
} from "@/core/paywalls/project/framework";
import { readLock } from "@/core/paywalls/project/lock";
import { collectProjectDeclarations, writeProjectTypes } from "@/core/paywalls/project/types";
import { ui } from "@/ui";
import { kb, took } from "./pipeline/report";
import { parseIds, projectDir, requireProject, selectSurfaces } from "./pipeline/selection";

const PLATFORMS = new Set(["ios", "android", "web"]);

export interface BuildOutcome {
  kind: FrameworkSurface["kind"];
  id: string;
  platform: string | null;
  file: string;
  bytes: number;
  snapshotId: string;
}

export function parseBuildPlatforms(value: unknown): Array<string | undefined> {
  const platforms = parseIds(value);
  for (const platform of platforms) {
    if (!PLATFORMS.has(platform)) {
      throw new Error(`Unknown platform "${platform}" — use ios, android or web.`);
    }
  }
  return platforms.length === 0 ? [undefined] : platforms;
}

export function outputFile(
  out: string,
  surface: Pick<FrameworkSurface, "kind" | "id">,
  platform: string | undefined,
): string {
  return path.join(out, surface.kind, surface.id, ...(platform ? [platform] : []), "index.html");
}

function boundAssetBaseUrl(
  project: FrameworkProject,
  surface: FrameworkSurface,
  platform: string | undefined,
): string | undefined {
  if (platform === undefined) return undefined;
  const lock = readLock(project.superwallDir);
  const section = surface.kind === "paywall" ? lock.paywalls : lock.funnels;
  const applicationId = lock.apps[platform];
  if (section[surface.id]?.[platform] === undefined || applicationId === undefined) return undefined;
  return assetBaseUrl(applicationId);
}

export async function runBuildPipeline(
  context: CommandContext,
  options: { load?: (dir: string) => Promise<Framework> } = {},
): Promise<BuildOutcome[]> {
  const dir = projectDir(context);
  const framework = await (options.load ?? loadFramework)(dir);
  const project = requireProject(framework.discoverProject(dir), dir);
  writeProjectTypes(project, (await collectProjectDeclarations(framework, project.root)).products);
  const surfaces = selectSurfaces(project, context.argv.id);
  const platforms = parseBuildPlatforms(context.argv.platform);
  const out = path.resolve(
    typeof context.argv.out === "string" && context.argv.out !== ""
      ? context.argv.out
      : path.join(project.superwallDir, ".superwall", "build"),
  );

  context.output.render({ kind: "intro", text: `Superwall ${pc.dim(`v${VERSION}`)}` });
  for (const surface of surfaces) {
    for (const problem of surface.diagnostics ?? []) ui.warn(problem);
  }

  const outcomes: BuildOutcome[] = [];
  const at = Date.now();
  for (const surface of surfaces) {
    for (const platform of platforms) {
      const built = await framework.buildSnapshot(project, surface, {
        platform,
        assetBaseUrl: boundAssetBaseUrl(project, surface, platform),
      });
      const file = outputFile(out, surface, platform);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, built.html);
      outcomes.push({
        kind: surface.kind,
        id: surface.id,
        platform: platform ?? null,
        file,
        bytes: built.bytes,
        snapshotId: built.snapshotId,
      });
      context.output.render({
        kind: "step",
        text: `${surface.kind}/${surface.id}${platform ? ` ${platform}` : ""} ${pc.dim(`${kb(built.bytes)} · ${built.snapshotId.slice(0, 8)}`)} → ${path.relative(process.cwd(), file)}`,
      });
    }
  }
  context.output.render({
    kind: "outro",
    text: `${outcomes.length} ${outcomes.length === 1 ? "snapshot" : "snapshots"} built ${took(at)}`,
  });
  if (context.json) context.output.data({ builds: outcomes });
  return outcomes;
}

export const runBuild = defineCommand({
  name: "build",
  output: "both",
  async run(context) {
    await runBuildPipeline(context);
  },
});
