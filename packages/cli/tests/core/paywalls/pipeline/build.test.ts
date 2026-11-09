import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import {
  outputFile,
  teleportPageFile,
  parseBuildPlatforms,
  runBuildPipeline,
  type BuildContext,
} from "@/core/paywalls/pipeline/build";
import type {
  BuildOptions,
  Framework,
  FrameworkProject,
  FrameworkSurface,
} from "@/core/paywalls/project/framework";
import { writeApp, writeBinding } from "@/core/paywalls/project/lock";
import { createCommandOutput } from "@/program/output";
import { ui } from "@/ui";
import { selectRenderer } from "@/ui/select";

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

function contextFor(json = false): { context: BuildContext; stdout: () => string } {
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
    context: { output, json },
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
  const { context } = contextFor();

  const outcomes = await runBuildPipeline(context, {
    dir: project.root,
    load: async () => frameworkFor(project, calls),
  });

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
  const { context } = contextFor();

  const outcomes = await runBuildPipeline(context, {
    dir: project.root,
    platforms: ["ios,android"],
    load: async () => frameworkFor(project, calls),
  });

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
  const { context, stdout } = contextFor(true);

  await runBuildPipeline(context, {
    dir: project.root,
    ids: ["onboarding"],
    out,
    load: async () => frameworkFor(project, []),
  });

  const parsed = JSON.parse(stdout()) as { builds: Array<{ id: string; file: string; bytes: number }> };
  assert.deepEqual(parsed.builds.map((one) => one.id), ["onboarding"]);
  assert.equal(parsed.builds[0]?.file, path.join(out, "paywall", "onboarding", "index.html"));
  assert.equal(parsed.builds[0]?.bytes, 13);
  assert.ok(fs.existsSync(parsed.builds[0]?.file ?? ""));
});

test("refuses a platform the framework has no build for", () => {
  assert.throws(() => parseBuildPlatforms(["macos"]), /Unknown platform "macos"/);
  assert.deepEqual(parseBuildPlatforms([]), [undefined]);
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

test("a literal a design token holds is reported as a warning, and the build still writes", async () => {
  const project = scaffold(["pro"]);
  const surface = project.surfaces[0]!;
  surface.dir = path.join(project.superwallDir, "paywalls", "pro");
  fs.mkdirSync(path.join(surface.dir, "app"), { recursive: true });
  fs.mkdirSync(path.join(project.superwallDir, "design"));
  fs.writeFileSync(path.join(project.superwallDir, "design", "tokens.css"), ":root { --space-4: 16px; }\n");
  fs.writeFileSync(path.join(surface.dir, "app", "theme.css"), ".a { padding: 16px; }\n");
  const warnings: string[] = [];
  const warn = ui.warn;
  ui.warn = (message: string) => void warnings.push(message);
  try {
    const outcomes = await runBuildPipeline(contextFor().context, { dir: project.root, load: async () => frameworkFor(project, []) });
    assert.equal(outcomes.length, 1);
  } finally {
    ui.warn = warn;
  }
  assert.deepEqual(warnings.map((warning) => warning.includes("var(--space-4)")), [true]);
});

test("teleport pages are written beside the document and listed, and pre-render warnings are shown", async () => {
  const project = scaffold(["pro"]);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-build-out-"));
  dirs.push(out);
  const base = frameworkFor(project, []);
  const framework: Framework = {
    ...base,
    buildSnapshot: async (...args) => ({
      ...(await base.buildSnapshot(...args)),
      teleportPages: [
        { key: "en/annual/1", html: "<main>annual</main>" },
        { key: "en/__none__/0", html: "<main>none</main>" },
      ],
      warnings: ["teleport page de/annual/1 failed to pre-render: boom"],
    }),
  };
  const stale = path.join(out, "paywall", "pro", "teleport", "de", "old", "1.html");
  fs.mkdirSync(path.dirname(stale), { recursive: true });
  fs.writeFileSync(stale, "stale");
  const warnings: string[] = [];
  const warn = ui.warn;
  ui.warn = (message: string) => void warnings.push(message);
  const { context, stdout } = contextFor(true);
  try {
    await runBuildPipeline(context, { dir: project.root, out, load: async () => framework });
  } finally {
    ui.warn = warn;
  }

  const parsed = JSON.parse(stdout()) as { builds: Array<{ file: string; teleportPages: string[] }> };
  const file = parsed.builds[0]!.file;
  assert.deepEqual(parsed.builds[0]?.teleportPages, ["en/annual/1", "en/__none__/0"]);
  assert.equal(fs.readFileSync(teleportPageFile(file, "en/annual/1"), "utf8"), "<main>annual</main>");
  assert.equal(teleportPageFile(file, "en/annual/1"), path.join(out, "paywall", "pro", "teleport", "en", "annual", "1.html"));
  assert.equal(fs.existsSync(stale), false);
  assert.deepEqual(warnings, ["teleport page de/annual/1 failed to pre-render: boom"]);
});

test("the step line counts the teleport pages a build made", async () => {
  const project = scaffold(["pro"]);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-build-out-"));
  dirs.push(out);
  const base = frameworkFor(project, []);
  const steps: string[] = [];
  const { context } = contextFor();
  const render = context.output.render.bind(context.output);
  context.output.render = (event) => {
    if (event.kind === "step") steps.push(event.text);
    render(event);
  };
  await runBuildPipeline(context, {
    dir: project.root,
    out,
    load: async () => ({
      ...base,
      buildSnapshot: async (...args) => ({
        ...(await base.buildSnapshot(...args)),
        teleportPages: [{ key: "en/__none__/1", html: "<main/>" }],
      }),
    }),
  });
  assert.equal(steps.length, 1);
  assert.match(steps[0]!, /1 teleport page\b/);
});
