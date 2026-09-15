import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import pc from "picocolors";
import {
  createApplication,
  listApplications,
  listProjects,
  platformLabel,
  type Application,
} from "@/core/api/resources";
import type { SuperwallApi } from "@/core/api/client";
import { resolveScopeFromKey } from "@/core/account/bind";
import {
  adoptExamplePackage,
  downloadExample,
  EXAMPLES_REPO,
  ExampleError,
  listExamples,
} from "@/core/paywalls/project/examples";
import { requirePlatform } from "@/core/paywalls/binding/apps";
import { writeApp } from "@/core/paywalls/project/lock";
import { projectPackageName } from "@/core/paywalls/project/scaffold";
import { LoginRequiredError, requireApi } from "@/core/paywalls/project/session";
import {
  isSuperwallProject,
  migrationFor,
  offerMigration,
  projectDirOf,
  scaffoldFromPaywall,
  type PaywallMigration,
} from "@/core/paywalls/migration";
import { slugOf } from "@/core/paywalls/project/origin";
import { starterConfig, writeSurfaceFiles, writeTemplate } from "@/core/paywalls/project/template";
import { defineCommand, type CommandContext } from "@/command";
import { askStudio, migrationNextSteps, startStudio } from "./open-studio";
import { gitAvailable } from "@/core/paywalls/source/git";
import { detectExisting, type ExistingIntegration } from "@/core/project/existing";
import { scanProject, type DetectedApp } from "@/core/project/scan";
import { readPackageJson, allDeps } from "@/core/project/package";
import type { Renderer } from "@/ui";

const run = promisify(execFile);

const APP_PLATFORMS = ["ios", "android", "flutter", "react_native", "web"] as const;

export function alreadyAProject(root: string): string | undefined {
  const target = path.join(root, "superwall");
  if (isSuperwallProject(target)) {
    return `\`${target}\` is already a superwall project — run \`superwall dev\` to open it.`;
  }
  if (fs.existsSync(path.join(target, "package.json"))) {
    return `\`${target}\` already has a package.json that isn't a superwall project — move it aside first.`;
  }
  for (const marker of ["superwall.config.ts", "superwall.lock"]) {
    if (fs.existsSync(path.join(root, marker))) {
      return `\`${root}\` is already a superwall project — run \`superwall dev\` to open it.`;
    }
  }
  const parsed = readPackageJson(root);
  if (parsed && "superwall" in allDeps(parsed)) {
    return `\`${root}\` is already a superwall project — run \`superwall dev\` to open it.`;
  }
  return undefined;
}

const LOCKFILES: ReadonlyArray<readonly [string, string]> = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

async function available(manager: string): Promise<boolean> {
  try {
    await run(manager, ["--version"], { shell: process.platform === "win32" });
    return true;
  } catch {
    return false;
  }
}

async function detectPackageManager(root: string): Promise<string> {
  const agent = process.env.npm_config_user_agent ?? "";
  const candidates = [
    ...LOCKFILES.filter(([file]) => fs.existsSync(path.join(root, file))).map(
      ([, manager]) => manager,
    ),
    ...["bun", "pnpm", "yarn", "npm"].filter((manager) => agent.startsWith(manager)),
    "bun",
  ];
  for (const manager of candidates) {
    if (await available(manager)) return manager;
  }
  return "npm";
}

function devCommand(manager: string): string {
  return manager === "npm" ? "npm run dev" : `${manager} dev`;
}

async function installDependencies(
  ui: Renderer,
  target: string,
  manager: string,
): Promise<boolean> {
  const spin = ui.spinner();
  spin.start(`Installing dependencies with ${manager}`);
  try {
    await run(manager, ["install"], {
      cwd: target,
      shell: process.platform === "win32",
      timeout: 300_000,
    });
    spin.stop("Dependencies installed");
    return true;
  } catch {
    spin.stop(`\`${manager} install\` failed — run it yourself in superwall/`);
    return false;
  }
}

async function initGit(ui: Renderer, root: string): Promise<void> {
  if (!(await gitAvailable())) return;
  try {
    await run("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root });
    return;
  } catch {
  }
  try {
    await run("git", ["init", "--quiet"], { cwd: root });
    await run("git", ["add", "-A"], { cwd: root });
    await run("git", ["commit", "--quiet", "-m", "New superwall project"], { cwd: root });
    ui.step("Initialized a git repository");
  } catch {
  }
}

function humanName(root: string): string {
  return projectPackageName(root)
    .split(/[-_.]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

async function detectHostApp(
  root: string,
): Promise<{ app: DetectedApp; existing: ExistingIntegration } | undefined> {
  try {
    const scanned = await scanProject(root);
    const app = scanned.apps[0];
    if (!app) return undefined;
    return { app, existing: detectExisting(app) };
  } catch {
    return undefined;
  }
}

async function createAppFlow(
  ui: Renderer,
  api: SuperwallApi,
  root: string,
): Promise<Application | null> {
  const projects = await listProjects(api);
  if (projects.length === 0) {
    ui.warn("Your account has no projects yet — create one in the dashboard first.");
    return null;
  }
  let project = projects[0]!;
  if (projects.length > 1) {
    const picked = await ui.select({
      message: "Which project does the app belong to?",
      options: projects.map((candidate) => ({
        value: String(candidate.id),
        label: candidate.name ?? String(candidate.id),
      })),
    });
    if (picked === null) return null;
    project = projects.find((candidate) => String(candidate.id) === picked) ?? project;
  }

  const name = await ui.text({
    message: "What is the app called?",
    initialValue: humanName(root),
    validate: (value) => (value.trim() === "" ? "Give the app a name." : undefined),
  });
  if (name === null) return null;

  const platform = await ui.select({
    message: "Which platform?",
    options: APP_PLATFORMS.map((value) => ({ value, label: platformLabel(value) })),
  });
  if (platform === null) return null;

  const spin = ui.spinner();
  spin.start("Creating the app");
  const created = await createApplication(
    api,
    { projectId: String(project.id) },
    { name: name.trim(), platform },
  );
  spin.stop(`Created \`${name.trim()}\``);
  if (created.id === undefined) return null;
  return { id: created.id, name: name.trim(), platform };
}

async function connectApp(
  ui: Renderer,
  interactive: boolean,
  root: string,
  target: string,
  detected: { app: DetectedApp; existing: ExistingIntegration } | undefined,
  appId: string | undefined,
): Promise<void> {
  const api = await requireApi(interactive);

  if (appId !== undefined) {
    const apps = await listApplications(api);
    const app = apps.find((candidate) => String(candidate.id) === appId);
    if (app === undefined) {
      throw new Error(
        `No app with id \`${appId}\` in this account — run \`superwall apps\` to list them.`,
      );
    }
    writeApp(target, requirePlatform(app), String(app.id));
    ui.success(
      `Pushes go to \`${app.name ?? app.id}\` — saved in superwall.lock, so commit that file.`,
    );
    return;
  }

  if (detected?.existing.apiKey) {
    const scope = await resolveScopeFromKey(api, detected.existing.apiKey).catch(() => null);
    if (scope) {
      const known = await listApplications(api).catch((): Application[] => []);
      const app = known.find((candidate) => String(candidate.id) === scope.applicationId) ?? {
        id: scope.applicationId,
      };
      writeApp(target, requirePlatform(app), scope.applicationId);
      ui.success(
        `\`${detected.app.name}\` is already on Superwall as \`${scope.appName ?? scope.applicationId}\` — pushes go there. Saved in superwall.lock; commit that file.`,
      );
      return;
    }
    ui.info(
      "Found a Superwall API key in the app, but no matching app in this account — pick one instead.",
    );
  }

  const apps = await listApplications(api);
  let app: Application | null = null;
  if (apps.length === 1 && apps[0] !== undefined) {
    app = apps[0];
  } else if (apps.length > 1) {
    if (!interactive) {
      ui.info("Several apps in your account — the first `superwall push` will ask which one.");
      return;
    }
    const picked = await ui.select({
      message: "Which app should these paywalls push to?",
      options: [
        ...apps.map((candidate) => ({
          value: String(candidate.id),
          label: candidate.name ?? candidate.bundle_id ?? String(candidate.id),
          hint: platformLabel(candidate.platform),
        })),
        { value: "__new__", label: "Create a new app" },
      ],
    });
    if (picked === null) return;
    app =
      picked === "__new__"
        ? await createAppFlow(ui, api, root)
        : (apps.find((candidate) => String(candidate.id) === picked) ?? null);
  } else {
    if (!interactive) {
      ui.info("Your account has no apps yet — the first `superwall push` will set one up.");
      return;
    }
    app = await createAppFlow(ui, api, root);
  }

  if (app === null) return;
  writeApp(target, requirePlatform(app), String(app.id));
  ui.success(
    `Pushes go to \`${app.name ?? app.id}\` — saved in superwall.lock, so commit that file.`,
  );
}

const uniqueSurfaceId = (superwallDir: string, slug: string): string => {
  let candidate = slug;
  for (let n = 2; fs.existsSync(path.join(superwallDir, "paywalls", candidate)); n += 1) {
    candidate = `${slug}-${n}`;
  }
  return candidate;
};

async function addSurface(context: CommandContext<"none">, superwallDir: string): Promise<void> {
  const { argv, interactive, ui } = context;
  const where = path.relative(process.cwd(), superwallDir) || ".";
  if (typeof argv.example === "string") {
    throw new Error(
      `\`${where}\` is already a superwall project — an example is a whole project, so start it in an empty directory.`,
    );
  }
  if (argv.app !== undefined) {
    throw new Error(
      `\`${where}\` is already connected — its apps live in superwall.lock; drop \`--app\`.`,
    );
  }
  const from =
    typeof argv.from === "string" || typeof argv.from === "number" ? String(argv.from) : undefined;

  if (from !== undefined) {
    const api = await requireApi(interactive);
    const origin = await scaffoldFromPaywall(ui, api, {
      root: process.cwd(),
      target: superwallDir,
      paywallId: from,
      newProject: false,
    });
    const migration = migrationFor(superwallDir, origin.id);
    const rebuilt =
      migration !== undefined && interactive && argv.yes !== true
        ? await offerMigration(ui, interactive, migration)
        : "later";
    const opening =
      rebuilt === "agent" &&
      migration !== undefined &&
      (await askStudio(ui, interactive, migration.surfaceId));
    ui.step("Next steps");
    ui.list({
      items: migrationNextSteps(opening, where, from, rebuilt).map((label) => ({ label })),
    });
    if (opening && migration !== undefined) await startStudio(superwallDir, migration.surfaceId);
    return;
  }

  const asked =
    interactive && argv.yes !== true
      ? await ui.text({
          message: "What is the paywall called?",
          initialValue: "Pro",
          validate: (value) => (value.trim() === "" ? "Give the paywall a name." : undefined),
        })
      : "Pro";
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

export const runCreate = defineCommand({
  name: "create",
  output: "human",
  async run(context) {
    const { argv, interactive, ui } = context;

    ui.intro(`Superwall ${pc.dim("create")}`);

    const root = path.resolve(typeof argv.dir === "string" ? argv.dir : process.cwd());
    const existing = projectDirOf(root);
    if (existing !== undefined) {
      await addSurface(context, existing);
      return;
    }
    const problem = alreadyAProject(root);
    if (problem !== undefined) throw new Error(problem);
    const target = path.join(root, "superwall");
    const appId =
      typeof argv.app === "string" || typeof argv.app === "number" ? String(argv.app) : undefined;
    if (appId !== undefined && argv.connect === false) {
      throw new Error("`--app` connects the project to that app — drop `--no-connect`.");
    }

    const detection = detectHostApp(root);

    const from =
      typeof argv.from === "string" || typeof argv.from === "number" ? String(argv.from) : undefined;
    let example = typeof argv.example === "string" ? argv.example : undefined;
    if (from !== undefined && example !== undefined) {
      throw new Error("`--from` rebuilds a dashboard paywall as the starter — drop `--example`.");
    }
    if (from !== undefined && argv.connect === false) {
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

    if (from === undefined && example === undefined && interactive && argv.yes !== true) {
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
          ui.warn(
            `${error instanceof ExampleError ? error.message : String(error)}\nStarting from minimal instead.`,
          );
        }
      }
    }

    if (from !== undefined) {
    } else if (example === undefined) {
      writeTemplate(target, projectPackageName(root));
      ui.step("Created superwall/ from the minimal template");
    } else {
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

    const connect =
      argv.connect === false || originBound
        ? false
        : interactive && argv.yes !== true && appId === undefined && from === undefined
          ? await ui.confirm({
              message: "Connect your Superwall account now? (Recommended)",
              initial: true,
            })
          : true;
    if (connect === true) {
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
    const installed = argv.install === false ? false : await installDependencies(ui, target, manager);

    await initGit(ui, root);

    const rebuilt =
      migration !== undefined && interactive && argv.yes !== true
        ? await offerMigration(ui, interactive, migration)
        : "later";
    const opening =
      rebuilt === "agent" &&
      migration !== undefined &&
      (await askStudio(ui, interactive, migration.surfaceId));

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
              ...migrationNextSteps(opening, "superwall", from, rebuilt).map((label) => ({
                label,
              })),
              ...integrate,
            ],
    });
    if (opening && migration !== undefined) await startStudio(target, migration.surfaceId);
  },
});
