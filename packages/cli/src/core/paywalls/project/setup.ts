import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { resolveScopeFromKey } from "@/core/account/bind";
import type { SuperwallApi } from "@/core/api/client";
import {
  createApplication,
  listApplications,
  listProjects,
  platformLabel,
  type Application,
} from "@/core/api/resources";
import { requirePlatform } from "@/core/paywalls/binding/apps";
import { isSuperwallProject } from "@/core/paywalls/migration";
import { writeApp } from "@/core/paywalls/project/lock";
import { projectPackageName } from "@/core/paywalls/project/scaffold";
import { requireApi } from "@/core/paywalls/project/session";
import { gitAvailable } from "@/core/paywalls/source/git";
import { detectExisting, type ExistingIntegration } from "@/core/codebase/existing";
import { allDeps, readPackageJson } from "@/core/codebase/package";
import { scanProject, type DetectedApp } from "@/core/codebase/scan";
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

export async function detectPackageManager(root: string): Promise<string> {
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

export function devCommand(manager: string): string {
  return manager === "npm" ? "npm run dev" : `${manager} dev`;
}

export async function installDependencies(
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

export async function initGit(ui: Renderer, root: string): Promise<void> {
  if (!(await gitAvailable())) return;
  const inside = await run("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root }).then(
    () => true,
    () => false,
  );
  if (inside) return;
  try {
    await run("git", ["init", "--quiet"], { cwd: root });
    await run("git", ["add", "-A"], { cwd: root });
    await run("git", ["commit", "--quiet", "-m", "New superwall project"], { cwd: root });
    ui.step("Initialized a git repository");
  } catch {
    return;
  }
}

function humanName(root: string): string {
  return projectPackageName(root)
    .split(/[-_.]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export async function detectHostApp(
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
  const [first] = projects;
  if (first === undefined) {
    ui.warn("Your account has no projects yet — create one in the dashboard first.");
    return null;
  }
  let project = first;
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

export async function connectApp(
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

export function uniqueSurfaceId(superwallDir: string, slug: string): string {
  let candidate = slug;
  for (let n = 2; fs.existsSync(path.join(superwallDir, "paywalls", candidate)); n += 1) {
    candidate = `${slug}-${n}`;
  }
  return candidate;
}
