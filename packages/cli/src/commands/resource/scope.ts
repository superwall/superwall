import * as fs from "node:fs";
import * as path from "node:path";
import type { CommandContext } from "@/command";
import type { SuperwallApi } from "@/core/api/client";
import {
  getPaywallApplicationId,
  listProjects,
  platformLabel,
  type Application,
  type Project,
  type Scope,
} from "@/core/api/resources";
import { getDefaultApp, setDefaultApp } from "@/core/state/config";
import { detectExisting } from "@/core/project/existing";
import { scanProject } from "@/core/project/scan";
import { apiCall } from "@/util/api-output";

interface LocalApp {
  apiKey?: string;
  name?: string;
}

async function detectLocal(installDir: string): Promise<LocalApp> {
  const scan = await scanProject(installDir).catch(() => null);
  const detected = scan?.apps[0];
  if (!detected) return {};
  return { apiKey: detectExisting(detected).apiKey, name: detected.name };
}

function moveFirst<T>(items: T[], match: (item: T) => boolean): T[] {
  const idx = items.findIndex(match);
  if (idx <= 0) return items;
  return [items[idx]!, ...items.slice(0, idx), ...items.slice(idx + 1)];
}

function matchProject(projects: Project[], local: LocalApp): { project?: Project; exact: boolean } {
  if (local.apiKey) {
    const p = projects.find((project) =>
      (project.applications ?? []).some((a) => a.public_api_key === local.apiKey),
    );
    if (p) return { project: p, exact: true };
  }
  if (local.name) {
    const p = projects.find(
      (project) =>
        project.name === local.name ||
        (project.applications ?? []).some((a) => a.name === local.name),
    );
    if (p) return { project: p, exact: false };
  }
  return { exact: false };
}

function matchApp(apps: Application[], local: LocalApp): Application | undefined {
  if (local.apiKey) {
    const a = apps.find((app) => app.public_api_key === local.apiKey);
    if (a) return a;
  }
  if (local.name) return apps.find((app) => app.name === local.name);
  return undefined;
}

export interface PickedScope extends Scope {
  appPlatform?: string;
  projectCount: number;
  appCount: number;
}

function lockBoundPaywallId(installDir: string): string | undefined {
  for (const file of [
    path.join(installDir, "superwall.lock"),
    path.join(installDir, "superwall", "superwall.lock"),
  ]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
        paywalls?: Record<string, { paywallId?: string }>;
        funnels?: Record<string, { paywallId?: string }>;
      };
      const entry = Object.values({ ...parsed.paywalls, ...parsed.funnels }).find(
        (binding) => binding?.paywallId,
      );
      if (entry?.paywallId) return String(entry.paywallId);
    } catch {
      continue;
    }
  }
  return undefined;
}

async function lockBoundScope(
  context: CommandContext,
  api: SuperwallApi,
  projects: Project[],
): Promise<{ project: Project; app: Application } | undefined> {
  if (context.argv.project || context.argv.app) return undefined;
  const paywallId = lockBoundPaywallId(context.installDir);
  if (!paywallId) return undefined;
  const applicationId = await getPaywallApplicationId(api, paywallId).catch(() => undefined);
  if (!applicationId) return undefined;
  const project = projects.find((candidate) =>
    (candidate.applications ?? []).some((app) => String(app.id) === applicationId),
  );
  const app = project?.applications?.find(
    (candidate) => String(candidate.id) === applicationId,
  );
  if (!project || !app) return undefined;
  context.ui.info(`Using \`${app.name ?? applicationId}\` - bound in superwall.lock.`);
  return { project, app };
}

export async function pickScope(
  context: CommandContext,
  api: SuperwallApi,
  appScoped: boolean,
): Promise<PickedScope> {
  const projects = await apiCall(context, "Loading projects", () => listProjects(api));

  const bound = await lockBoundScope(context, api, projects);
  if (bound) {
    return {
      projectId: String(bound.project.id),
      applicationId: appScoped ? String(bound.app.id) : undefined,
      projectName: bound.project.name,
      appName: appScoped ? bound.app.name : undefined,
      appPlatform: appScoped ? bound.app.platform : undefined,
      projectCount: projects.length,
      appCount: bound.project.applications?.length ?? 0,
    };
  }

  const project = await pickProject(context, projects);
  const projectId = String(project.id);
  const apps = project.applications ?? [];

  let app: Application | undefined;
  if (appScoped) {
    const appFlag = context.argv.app as string | undefined;
    const remembered = apps.find((candidate) => String(candidate.id) === getDefaultApp(projectId));

    if (appFlag) {
      app = apps.find(
        (candidate) => String(candidate.id) === appFlag || candidate.name === appFlag,
      );
      if (!app) {
        throw new Error(`No app ${appFlag} in ${project.name ?? projectId}.`);
      }
      setDefaultApp(projectId, String(app.id));
    } else if (apps.length <= 1) {
      app = apps[0];
    } else if (!context.interactive) {
      throw new Error(`Multiple apps found in ${project.name ?? projectId}. Pass --app <id>.`);
    } else {
      app = await chooseApp(context, apps, remembered ?? apps[0]!);
      setDefaultApp(projectId, String(app.id));
    }
  }

  return {
    projectId,
    applicationId: app ? String(app.id) : undefined,
    projectName: project.name,
    appName: app?.name,
    appPlatform: app?.platform,
    projectCount: projects.length,
    appCount: apps.length,
  };
}

export async function pickProject(context: CommandContext, projects: Project[]): Promise<Project> {
  const projectFlag = context.argv.project as string | undefined;
  if (projectFlag) {
    const p = projects.find((c) => String(c.id) === projectFlag);
    if (!p) throw new Error(`No project ${projectFlag} in this organization.`);
    return p;
  }
  if (projects.length === 0) {
    throw new Error("No project found in this organization.");
  }
  if (projects.length === 1) return projects[0]!;

  const { project: preferred, exact } = matchProject(
    projects,
    await detectLocal(context.installDir),
  );
  if (exact && preferred) {
    context.ui.info(`Using \`${preferred.name}\` - detected in this directory.`);
    return preferred;
  }
  if (!context.interactive) {
    throw new Error("Multiple projects found. Pass --project <id>.");
  }
  return chooseProject(context, projects, preferred);
}

async function chooseProject(
  context: CommandContext,
  projects: Project[],
  preferred?: Project,
): Promise<Project> {
  const ordered = preferred
    ? moveFirst(projects, (p) => String(p.id) === String(preferred.id))
    : projects;
  const selection = await context.ui.select({
    message: "Which project?",
    options: ordered.map((project) => ({
      value: String(project.id),
      label: project.name ?? String(project.id),
    })),
    initialValue: preferred ? String(preferred.id) : undefined,
  });
  if (selection === null) throw new Error("Cancelled.");
  return projects.find((project) => String(project.id) === selection)!;
}

export async function chooseApp(
  context: CommandContext,
  apps: Application[],
  defaultApp: Application,
): Promise<Application> {
  const detected = matchApp(apps, await detectLocal(context.installDir));
  const top = detected ?? defaultApp;
  const ordered = moveFirst(apps, (app) => String(app.id) === String(top.id));
  const selection = await context.ui.select({
    message: "Which app?",
    options: ordered.map((app) => ({
      value: String(app.id),
      label: app.name ?? String(app.id),
      hint: platformLabel(app.platform),
    })),
    initialValue: String(top.id),
  });
  if (selection === null) throw new Error("Cancelled.");
  return apps.find((app) => String(app.id) === selection) ?? top;
}
