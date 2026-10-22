import * as fs from "node:fs";
import * as path from "node:path";
import pc from "picocolors";
import type { CommandContext } from "@/program/command";
import {
  migrationFor,
  offerMigration,
  projectDirOf,
  scaffoldFromPaywall,
  type PaywallMigration,
} from "@/core/paywalls/migration";
import { askStudio, migrationNextSteps, startStudio } from "@/core/paywalls/studio/open";
import {
  adoptExamplePackage,
  downloadExample,
  EXAMPLES_REPO,
  ExampleError,
  listExamples,
} from "@/core/paywalls/project/examples";
import { slugOf } from "@/core/paywalls/project/origin";
import { projectPackageName } from "@/core/paywalls/project/scaffold";
import { LoginRequiredError, requireApi } from "@/core/paywalls/project/session";
import {
  alreadyAProject,
  connectApp,
  detectHostApp,
  detectPackageManager,
  devCommand,
  initGit,
  installDependencies,
  uniqueSurfaceId,
} from "@/core/paywalls/project/setup";
import { writeTemplate, starterConfig, writeSurfaceFiles } from "@/core/paywalls/project/template";

interface CreateRuntime {
  offerMigration: typeof offerMigration;
  askStudio: typeof askStudio;
  startStudio: typeof startStudio;
}

const runtime: CreateRuntime = { offerMigration, askStudio, startStudio };

interface CreateOptions {
  dir?: string;
  example?: string;
  from?: string;
  app?: string;
  yes: boolean;
  install: boolean;
  connect: boolean;
}

interface Rebuild {
  choice: Awaited<ReturnType<typeof offerMigration>>;
  studio?: PaywallMigration;
}

async function offerRebuild(
  ctx: CommandContext<"none">,
  options: CreateOptions,
  migration: PaywallMigration | undefined,
  deps: CreateRuntime,
): Promise<Rebuild> {
  const { interactive, ui } = ctx;
  if (migration === undefined || !interactive || options.yes) return { choice: "later" };
  const choice = await deps.offerMigration(ui, interactive, migration);
  if (choice !== "agent") return { choice };
  const opening = await deps.askStudio(ui, interactive, migration.surfaceId);
  return opening ? { choice, studio: migration } : { choice };
}

async function addSurface(
  ctx: CommandContext<"none">,
  options: CreateOptions,
  superwallDir: string,
  deps: CreateRuntime,
): Promise<void> {
  const { interactive, ui } = ctx;
  const where = path.relative(process.cwd(), superwallDir) || ".";
  if (options.example !== undefined) {
    throw new Error(
      `\`${where}\` is already a superwall project — an example is a whole project, so start it in an empty directory.`,
    );
  }
  if (options.app !== undefined) {
    throw new Error(`\`${where}\` is already connected — its apps live in superwall.lock; drop \`--app\`.`);
  }
  const from = options.from;

  if (from !== undefined) {
    const api = await requireApi(interactive);
    const origin = await scaffoldFromPaywall(ui, api, {
      root: process.cwd(),
      target: superwallDir,
      paywallId: from,
      newProject: false,
    });
    const rebuild = await offerRebuild(ctx, options, migrationFor(superwallDir, origin.id), deps);
    ui.step("Next steps");
    ui.list({
      items: migrationNextSteps(rebuild.studio !== undefined, where, from, rebuild.choice).map((label) => ({
        label,
      })),
    });
    if (rebuild.studio !== undefined) await deps.startStudio(superwallDir, rebuild.studio.surfaceId);
    return;
  }

  let asked: string | null = "Pro";
  if (interactive && !options.yes) {
    asked = await ui.text({
      message: "What is the paywall called?",
      initialValue: "Pro",
      validate: (value) => (value.trim() === "" ? "Give the paywall a name." : undefined),
    });
  }
  if (asked === null) return;
  const name = asked.trim();
  const id = uniqueSurfaceId(superwallDir, slugOf(name));
  writeSurfaceFiles(superwallDir, id, starterConfig(name));
  ui.step(`Created ${where}/paywalls/${id} from the minimal template`);
  ui.step("Next steps");
  ui.list({
    items: [
      {
        label: `paywalls/${id}/config.ts`,
        children: [{ label: "Point the product slot at a product that exists on your dashboard" }],
      },
      { label: "superwall dev", children: [{ label: "Open the studio and build the pages" }] },
    ],
  });
}

export async function runCreate(
  ctx: CommandContext<"none">,
  options: CreateOptions,
  deps: CreateRuntime = runtime,
): Promise<void> {
  const { interactive, ui } = ctx;

  ui.intro(`Superwall ${pc.dim("create")}`);

  const root = path.resolve(options.dir ?? process.cwd());
  const existing = projectDirOf(root);
  if (existing !== undefined) {
    await addSurface(ctx, options, existing, deps);
    return;
  }
  const problem = alreadyAProject(root);
  if (problem !== undefined) throw new Error(problem);
  const target = path.join(root, "superwall");
  const appId = options.app;
  if (appId !== undefined && !options.connect) {
    throw new Error("`--app` connects the project to that app — drop `--no-connect`.");
  }

  const detection = detectHostApp(root);

  const from = options.from;
  let example = options.example;
  if (from !== undefined && example !== undefined) {
    throw new Error("`--from` rebuilds a dashboard paywall as the starter — drop `--example`.");
  }
  if (from !== undefined && !options.connect) {
    throw new Error("`--from` connects the project to the paywall's app — drop `--no-connect`.");
  }

  let originAppId: string | undefined;
  let originBound = false;
  let migration: PaywallMigration | undefined;
  if (from !== undefined) {
    const api = await requireApi(interactive);
    const origin = await scaffoldFromPaywall(ui, api, {
      root,
      target,
      paywallId: from,
      newProject: true,
    });
    if (origin.applicationId !== undefined && origin.platform !== undefined) {
      originBound = true;
    } else {
      originAppId = origin.applicationId;
    }
    migration = migrationFor(target, origin.id);
  }

  if (from === undefined && example === undefined && interactive && !options.yes) {
    const start = await ui.select({
      message: "Start from",
      options: [
        { value: "minimal", label: "Minimal", hint: "one paywall, one product" },
        { value: "example", label: "An example", hint: `github.com/${EXAMPLES_REPO}` },
      ],
      initialValue: "minimal",
    });
    if (start === null) return;
    if (start === "example") {
      const spin = ui.spinner();
      spin.start("Fetching the example list");
      try {
        const examples = await listExamples();
        spin.stop(`${examples.length} examples`);
        const picked = await ui.select({
          message: "Which example?",
          options: examples.map((name) => ({ value: name, label: name })),
        });
        if (picked === null) return;
        example = picked;
      } catch (error) {
        spin.stop("Could not fetch the example list");
        ui.warn(`${error instanceof ExampleError ? error.message : String(error)}\nStarting from minimal instead.`);
      }
    }
  }

  if (from === undefined && example === undefined) {
    writeTemplate(target, projectPackageName(root));
    ui.step("Created superwall/ from the minimal template");
  } else if (from === undefined && example !== undefined) {
    const spin = ui.spinner();
    spin.start(`Downloading \`${example}\``);
    try {
      await downloadExample(example, target);
    } catch (error) {
      spin.stop("Download failed");
      fs.rmSync(target, { recursive: true, force: true });
      throw error;
    }
    adoptExamplePackage(target, projectPackageName(root));
    spin.stop(`Created superwall/ from the \`${example}\` example`);
  }

  const detected = await detection;
  if (detected?.existing.fullyIntegrated) {
    ui.info(`The Superwall SDK is already set up in \`${detected.app.name}\`.`);
  }

  let connect = options.connect && !originBound;
  if (connect && interactive && !options.yes && appId === undefined && from === undefined) {
    const answer = await ui.confirm({
      message: "Connect your Superwall account now? (Recommended)",
      initial: true,
    });
    connect = answer === true;
  }
  if (connect) {
    try {
      await connectApp(ui, interactive, root, target, detected, appId ?? originAppId);
    } catch (error) {
      if (appId !== undefined) throw error;
      if (error instanceof LoginRequiredError) {
        ui.info("Not signed in — the first `superwall push` will connect you.");
      } else {
        ui.warn(
          `${error instanceof Error ? error.message : String(error)}\nSkipping — the first \`superwall push\` connects you.`,
        );
      }
    }
  }

  const manager = await detectPackageManager(root);
  const installed = options.install && (await installDependencies(ui, target, manager));

  await initGit(ui, root);

  const rebuild = await offerRebuild(ctx, options, migration, deps);

  const integrate = detected?.existing.fullyIntegrated
    ? []
    : [
        {
          label: "superwall integrate",
          children: [{ label: "Set up the SDK in your app" }],
        },
      ];

  const dev = installed
    ? `cd superwall && ${devCommand(manager)}`
    : `cd superwall && ${manager} install && ${devCommand(manager)}`;

  ui.step("Next steps");
  ui.list({
    items:
      from === undefined
        ? [{ label: dev, children: [{ label: "Open the studio" }] }, ...integrate]
        : [
            ...migrationNextSteps(rebuild.studio !== undefined, "superwall", from, rebuild.choice).map((label) => ({
              label,
            })),
            ...integrate,
          ],
  });
  if (rebuild.studio !== undefined) await deps.startStudio(target, rebuild.studio.surfaceId);
}
