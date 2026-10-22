import type { CommandContext } from "@/program/command";
import { currentHost, type LocalApp, type LockRef } from "@/program/host";
import { chooseOrgOfApps } from "@/core/account/org";
import type { SuperwallApi } from "@/core/api/client";
import { appNotFound, findApplication, findProject } from "@/core/api/lookup";
import { listOrgGroups, orgIdOf, organizationOf } from "@/core/api/orgs";
import {
  findPaywall,
  listProjects,
  platformLabel,
  type Application,
  type Project,
  type Scope,
} from "@/core/api/resources";
import { readDefaultApp, writeDefaultApp } from "@/core/state/config";
import { apiCall } from "@/ui/spinner";

function moveFirst<T>(items: T[], match: (item: T) => boolean): T[] {
  const idx = items.findIndex(match);
  const item = items[idx];
  if (idx <= 0 || item === undefined) return items;
  return [item, ...items.slice(0, idx), ...items.slice(idx + 1)];
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

async function lockBoundScope(
  context: CommandContext,
  api: SuperwallApi,
  projects: Project[],
): Promise<{ project: Project; app: Application } | undefined> {
  if (context.target.project || context.target.app) return undefined;
  const appId = await resolveLockAppId(api, currentHost().readLockRef(context.installDir));
  if (!appId) return undefined;
  const found = await findApplication(api, appId, projects);
  if (!found) return undefined;
  context.ui.info(`Using \`${found.app.name ?? found.app.id}\` - bound in superwall.lock.`);
  return found;
}

async function resolveLockAppId(api: SuperwallApi, lock: LockRef | undefined): Promise<string | undefined> {
  if (lock?.appId !== undefined) return lock.appId;
  if (!lock?.paywallId) return undefined;
  const paywall = await findPaywall(api, lock.paywallId).catch(() => undefined);
  return paywall?.applicationId;
}

export async function pickScope(
  context: CommandContext,
  api: SuperwallApi,
  appScoped: boolean,
): Promise<PickedScope> {
  const projects = await apiCall(context, "Loading projects", () => listProjects(api));

  const appFlag = context.target.app;
  let bound: { project: Project; app: Application } | undefined;
  if (appFlag) bound = await namedApp(context, api, projects, appFlag);
  else bound = await lockBoundScope(context, api, projects);
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
    const remembered = apps.find((candidate) => String(candidate.id) === readDefaultApp(projectId));
    const [first] = apps;
    if (!first || apps.length === 1) {
      app = first;
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
      app = await chooseApp(context, apps, remembered ?? first);
      writeDefaultApp(projectId, String(app.id));
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

export async function boundOrganization(
  context: CommandContext,
  api: SuperwallApi,
): Promise<string | undefined> {
  const projects = await apiCall(context, "Loading projects", () => listProjects(api));
  const appFlag = context.target.app;
  let project: Project | undefined;
  if (appFlag) project = (await namedApp(context, api, projects, appFlag)).project;
  else if (context.target.project) project = await pickProject(context, api, projects);
  else project = (await lockBoundScope(context, api, projects))?.project;
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
  const [first] = orgs;
  if (first === undefined) {
    throw new Error("No projects yet - run `superwall apps create --name <name> --platform ios`.");
  }
  if (orgs.length === 1) return first;
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
  if (context.target.project) {
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
  writeDefaultApp(String(found.project.id), String(found.app.id));
  return found;
}

export async function pickProject(
  context: CommandContext,
  api: SuperwallApi,
  projects: Project[],
): Promise<Project> {
  const projectFlag = context.target.project;
  if (projectFlag) {
    const p = await findProject(api, projectFlag, projects);
    if (!p) throw new Error(`No project ${projectFlag} that this account can open.`);
    return p;
  }
  const [first] = projects;
  if (!first) {
    throw new Error("No projects yet - run `superwall apps create --name <name> --platform ios`.");
  }
  if (projects.length === 1) return first;

  const { project: preferred, exact } = matchProject(
    projects,
    await currentHost().detectApp(context.installDir),
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
  const chosen = projects.find((project) => String(project.id) === selection);
  if (!chosen) throw new Error(`No project ${selection}.`);
  return chosen;
}

export async function chooseApp(
  context: CommandContext,
  apps: Application[],
  defaultApp: Application,
): Promise<Application> {
  const detected = matchApp(apps, await currentHost().detectApp(context.installDir));
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
