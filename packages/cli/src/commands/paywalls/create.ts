import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import pc from "picocolors";
import { defineCommand } from "@/command";
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
import { writeTemplate } from "@/core/paywalls/project/template";
import { gitAvailable } from "@/core/paywalls/source/git";
import { detectExisting, type ExistingIntegration } from "@/core/project/existing";
import { scanProject, type DetectedApp } from "@/core/project/scan";
import { readPackageJson, allDeps } from "@/util/fs";
import type { Renderer } from "@/ui";

const run = promisify(execFile);

const APP_PLATFORMS = ["ios", "android", "flutter", "react_native", "web"] as const;

export function alreadyAProject(root: string): string | undefined {
  const target = path.join(root, "superwall");
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
    return `\`${target}\` already exists — run \`superwall dev\` to open it.`;
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
): Promise<void> {
  const api = await requireApi(interactive);

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

export const runCreate = defineCommand({
  name: "create",
  output: "human",
  async run(context) {
    const { argv, interactive, ui } = context;

    ui.intro(`Superwall ${pc.dim("create")}`);

    const root = path.resolve(typeof argv.dir === "string" ? argv.dir : process.cwd());
    const problem = alreadyAProject(root);
    if (problem !== undefined) throw new Error(problem);
    const target = path.join(root, "superwall");

    const detection = detectHostApp(root);

    let example = typeof argv.example === "string" ? argv.example : undefined;
    if (example === undefined && interactive && argv.yes !== true) {
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

    if (example === undefined) {
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
      argv.connect === false
        ? false
        : interactive && argv.yes !== true
          ? await ui.confirm({
              message: "Connect your Superwall account now? (Recommended)",
              initial: true,
            })
          : true;
    if (connect === true) {
      try {
        await connectApp(ui, interactive, root, target, detected);
      } catch (error) {
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

    ui.step("Next steps");
    ui.list({
      items: [
        {
          label: installed
            ? `cd superwall && ${devCommand(manager)}`
            : `cd superwall && ${manager} install && ${devCommand(manager)}`,
          children: [{ label: "Open the studio" }],
        },
        ...(detected?.existing.fullyIntegrated
          ? []
          : [
              {
                label: "superwall integrate",
                children: [{ label: "Set up the SDK in your app" }],
              },
            ]),
      ],
    });
  },
});
