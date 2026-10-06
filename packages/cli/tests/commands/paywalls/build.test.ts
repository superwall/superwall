import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import type { Arguments } from "yargs";
import type { CommandContext } from "@/command";
import {
  outputFile,
  parseBuildPlatforms,
  runBuildPipeline,
} from "@/commands/paywalls/build";
import type {
  BuildOptions,
  Framework,
  FrameworkProject,
  FrameworkSurface,
} from "@/core/paywalls/project/framework";
import { writeApp, writeBinding } from "@/core/paywalls/project/lock";
import { createCommandOutput } from "@/output";
import { selectRenderer, ui } from "@/ui";

selectRenderer({ mode: "json" });

const dirs: string[] = [];

const surfaceOf = (id: string, kind: "paywall" | "funnel" = "paywall"): FrameworkSurface => ({
  kind,
  id,
  dir: `/tmp/${id}`,
  configFile: `/tmp/${id}/config.ts`,
  routes: [],
});

function scaffold(ids: string[] = ["plus-upgrade"]): FrameworkProject {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-build-"));
  dirs.push(dir);
  return {
    root: dir,
    superwallDir: dir,
    marker: "package.json",
    packageName: "acme-paywalls",
    surfaces: ids.map((id) => surfaceOf(id)),
    diagnostics: [],
  };
}

function frameworkFor(
  project: FrameworkProject,
  calls: Array<{ id: string; options: BuildOptions | undefined }>,
): Framework {
  return {
    discoverProject: () => project,
    buildSnapshot: async (_project, surface, options) => {
      calls.push({ id: surface.id, options });
      return {
        name: "Pro",
        snapshotId: `sha-${surface.id}-${options?.platform ?? "all"}`,
        html: `<html>${surface.id}</html>`,
        bytes: 13,
        htmlFile: "x",
        assets: [],
        assetBytes: 0,
      };
    },
    startPreviewServer: async () => ({}),
  };
}

function contextFor(argv: Partial<Arguments> = {}, json = false): { context: CommandContext; stdout: () => string } {
  let stdout = "";
  const output = createCommandOutput(json ? "json" : "text", ui, {
    stdout: {
      write: (value) => {
        stdout += String(value);
        return true;
      },
    },
  });
  return {
    context: {
      argv: { _: [], $0: "superwall", ...argv } as Arguments,
      ui,
      output,
      outputMode: json ? "json" : "text",
      interactive: false,
      installDir: process.cwd(),
      json,
      dryRun: false,
    } as CommandContext,
    stdout: () => stdout,
  };
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("writes one platform-neutral document per surface by default, inlining everything", async () => {
  const project = scaffold(["plus-upgrade", "onboarding"]);
  const calls: Array<{ id: string; options: BuildOptions | undefined }> = [];
  const { context } = contextFor({ dir: project.root });

  const outcomes = await runBuildPipeline(context, { load: async () => frameworkFor(project, calls) });

  assert.deepEqual(
    outcomes.map((one) => [one.id, one.platform, one.snapshotId]),
    [
      ["plus-upgrade", null, "sha-plus-upgrade-all"],
      ["onboarding", null, "sha-onboarding-all"],
    ],
  );
  assert.deepEqual(
    calls.map((call) => call.options),
    [
      { platform: undefined, assetBaseUrl: undefined },
      { platform: undefined, assetBaseUrl: undefined },
    ],
  );
  const file = path.join(project.superwallDir, ".superwall", "build", "paywall", "plus-upgrade", "index.html");
  assert.equal(outcomes[0]?.file, file);
  assert.equal(fs.readFileSync(file, "utf8"), "<html>plus-upgrade</html>");
});

test("a bound platform references the app's asset host; an unbound one inlines", async () => {
  const project = scaffold();
  writeApp(project.superwallDir, "ios", "42");
  writeBinding(project.superwallDir, "paywall", "plus-upgrade", "ios", { paywallId: "2080" });
  const calls: Array<{ id: string; options: BuildOptions | undefined }> = [];
  const { context } = contextFor({ dir: project.root, platform: ["ios,android"] });

  const outcomes = await runBuildPipeline(context, { load: async () => frameworkFor(project, calls) });

  assert.equal(calls[0]?.options?.platform, "ios");
  assert.match(calls[0]?.options?.assetBaseUrl ?? "", /\/42$/);
  assert.equal(calls[1]?.options?.platform, "android");
  assert.equal(calls[1]?.options?.assetBaseUrl, undefined);
  assert.deepEqual(
    outcomes.map((one) => path.relative(project.superwallDir, one.file)),
    [
      path.join(".superwall", "build", "paywall", "plus-upgrade", "ios", "index.html"),
      path.join(".superwall", "build", "paywall", "plus-upgrade", "android", "index.html"),
    ],
  );
});

test("--out and --id narrow where and what, and --json lists the files", async () => {
  const project = scaffold(["plus-upgrade", "onboarding"]);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-build-out-"));
  dirs.push(out);
  const { context, stdout } = contextFor({ dir: project.root, id: ["onboarding"], out }, true);

  await runBuildPipeline(context, { load: async () => frameworkFor(project, []) });

  const parsed = JSON.parse(stdout()) as { builds: Array<{ id: string; file: string; bytes: number }> };
  assert.deepEqual(parsed.builds.map((one) => one.id), ["onboarding"]);
  assert.equal(parsed.builds[0]?.file, path.join(out, "paywall", "onboarding", "index.html"));
  assert.equal(parsed.builds[0]?.bytes, 13);
  assert.ok(fs.existsSync(parsed.builds[0]?.file ?? ""));
});

test("refuses a platform the framework has no build for", () => {
  assert.throws(() => parseBuildPlatforms(["macos"]), /Unknown platform "macos"/);
  assert.deepEqual(parseBuildPlatforms(undefined), [undefined]);
  assert.deepEqual(parseBuildPlatforms(["ios", "web"]), ["ios", "web"]);
});

test("the output path nests the platform only when there is one", () => {
  assert.equal(
    outputFile("/o", { kind: "funnel", id: "welcome" }, undefined),
    path.join("/o", "funnel", "welcome", "index.html"),
  );
  assert.equal(
    outputFile("/o", { kind: "paywall", id: "pro" }, "web"),
    path.join("/o", "paywall", "pro", "web", "index.html"),
  );
});
