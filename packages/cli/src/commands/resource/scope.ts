import * as fs from "node:fs";
import * as path from "node:path";
import type { CommandContext } from "@/command";
import type { SuperwallApi } from "@/core/api/client";
import { appNotFound, findApplication, findProject } from "@/core/api/lookup";
import { listOrgGroups, orgIdOf, organizationOf } from "@/core/api/orgs";
import { chooseOrgOfApps } from "@/core/account/org";
import {
  getPaywall,
  listProjects,
  platformLabel,
  type Application,
  type Project,
  type Scope,
} from "@/core/api/resources";
import { getDefaultApp, setDefaultApp } from "@/core/state/config";
import { detectExisting } from "@/core/project/existing";
import { scanProject } from "@/core/project/scan";
import { apiCall } from "@/commands/api-output";

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

interface LockRef {
  appId?: string;
  paywallId?: string;
}

function readLock(installDir: string): LockRef | undefined {
  for (const file of [
    path.join(installDir, "superwall.lock"),
    path.join(installDir, "superwall", "superwall.lock"),
  ]) {
    let parsed: {
      apps?: Record<string, unknown>;
      paywalls?: Record<string, Record<string, unknown>>;
      funnels?: Record<string, Record<string, unknown>>;
    };
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const appId = Object.values(parsed.apps ?? {}).find((id) => typeof id === "string") as
      | string
      | undefined;
    let paywallId: string | undefined;
    for (const entry of Object.values({ ...parsed.paywalls, ...parsed.funnels })) {
      if (typeof entry?.paywallId === "string") paywallId = entry.paywallId;
      for (const binding of Object.values(entry ?? {})) {
        const id = (binding as { paywallId?: unknown } | null)?.paywallId;
        if (typeof id === "string") paywallId ??= id;
      }
      if (paywallId) break;
    }
    return { appId, paywallId };
  }
  return undefined;
}

async function lockBoundScope(
  context: CommandContext,
  api: SuperwallApi,
  projects: Project[],
): Promise<{ project: Project; app: Application } | undefined> {
  if (context.argv.project || context.argv.app) return undefined;
  const lock = readLock(context.installDir);
  const appId =
    lock?.appId ??
    (lock?.paywallId
      ? (await getPaywall(api, lock.paywallId).catch(() => undefined))?.applicationId
      : undefined);
  if (!appId) return undefined;
  const found = await findApplication(api, appId, projects);
  if (!found) return undefined;
  context.ui.info(`Using \`${found.app.name ?? found.app.id}\` - bound in superwall.lock.`);
  return found;
}

export async function pickScope(
  context: CommandContext,
  api: SuperwallApi,
  appScoped: boolean,
): Promise<PickedScope> {
  const projects = await apiCall(context, "Loading projects", () => listProjects(api));

  const appFlag = context.argv.app as string | undefined;
  const bound = appFlag
    ? await namedApp(context, api, projects, appFlag)
    : await lockBoundScope(context, api, projects);
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

  const project = await pickProject(context, api, projects);
  const projectId = String(project.id);
  const apps = project.applications ?? [];

  let app: Application | undefined;
  if (appScoped) {
    const remembered = apps.find((candidate) => String(candidate.id) === getDefaultApp(projectId));

    if (apps.length <= 1) {
      app = apps[0];
    } else if (!context.interactive) {
      throw new Error(
        `${project.name ?? projectId} has ${apps.length} apps - pass --app <id>:\n` +
          candidates(
            apps.map((a) =>
              [a.id, a.platform ? platformLabel(a.platform) : "", a.name ?? ""]
                .filter(Boolean)
                .join("  "),
            ),
          ),
      );
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

// Org-wide endpoints (analytics, App Store Connect, Search Ads) take the org of the app the
// command is about, so nobody has to select one.
export async function boundOrganization(
  context: CommandContext,
  api: SuperwallApi,
): Promise<string | undefined> {
  const projects = await apiCall(context, "Loading projects", () => listProjects(api));
  const appFlag = context.argv.app as string | undefined;
  const project = appFlag
    ? (await namedApp(context, api, projects, appFlag)).project
    : context.argv.project
      ? await pickProject(context, api, projects)
      : (await lockBoundScope(context, api, projects))?.project;
  return project && organizationOf(api, String(project.id), projects);
}

export async function pickOrganization(
  context: CommandContext,
  api: SuperwallApi,
): Promise<string> {
  const bound = await boundOrganization(context, api);
  if (bound) return bound;
  const projects = await listProjects(api);
  const orgs = [...new Set(projects.map(orgIdOf).filter((id): id is string => id !== undefined))];
  if (orgs.length === 1) return orgs[0]!;
  if (orgs.length === 0)
    throw new Error("No projects yet - run `superwall apps create <name> --platform ios`.");
  if (!context.interactive) {
    const groups = await listOrgGroups(api);
    throw new Error(
      `Your apps are in ${groups.length} organizations - pass --app <id|dashboard link> to say whose:\n` +
        candidates(
          groups.map((group) => {
            const app = group.projects.flatMap((p) => p.applications ?? [])[0];
            return `${group.name ?? `Organization ${group.id}`}${app ? `  e.g. --app ${app.id}` : ""}`;
          }),
        ),
    );
  }
  return chooseOrgOfApps(api, "Whose apps?");
}

async function namedApp(
  context: CommandContext,
  api: SuperwallApi,
  projects: Project[],
  appFlag: string,
): Promise<{ project: Project; app: Application }> {
  let found;
  if (context.argv.project) {
    const project = await pickProject(context, api, projects);
    const app = project.applications?.find(
      (candidate) => String(candidate.id) === appFlag || candidate.name === appFlag,
    );
    if (!app) throw new Error(`No app ${appFlag} in ${project.name ?? project.id}.`);
    found = { project, app };
  } else {
    found = await findApplication(api, appFlag, projects);
    if (!found) throw appNotFound(appFlag);
  }
  setDefaultApp(String(found.project.id), String(found.app.id));
  return found;
}

export async function pickProject(
  context: CommandContext,
  api: SuperwallApi,
  projects: Project[],
): Promise<Project> {
  const projectFlag = context.argv.project as string | undefined;
  if (projectFlag) {
    const p = await findProject(api, projectFlag, projects);
    if (!p) throw new Error(`No project ${projectFlag} that this account can open.`);
    return p;
  }
  if (projects.length === 0) {
    throw new Error("No projects yet - run `superwall apps create <name> --platform ios`.");
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
    throw new Error(
      `You can open ${projects.length} projects - pass --app <id|dashboard link> or --project <id>:\n` +
        candidates(
          projects.map(
            (p) =>
              `${p.id}  ${p.name ?? ""}${(p.applications ?? []).length ? `  (apps ${(p.applications ?? []).map((a) => a.id).join(", ")})` : ""}`,
          ),
        ),
    );
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

const CANDIDATES_SHOWN = 10;

function candidates(lines: string[]): string {
  const shown = lines.slice(0, CANDIDATES_SHOWN).map((line) => `  ${line.trimEnd()}`);
  if (lines.length > CANDIDATES_SHOWN) {
    shown.push(
      `  …and ${lines.length - CANDIDATES_SHOWN} more: \`superwall apps list\` lists them all.`,
    );
  }
  return shown.join("\n");
}
