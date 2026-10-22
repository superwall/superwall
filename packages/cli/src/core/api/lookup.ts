import { ApiError, type SuperwallApi } from "./client";
import { orgProjects, rememberOrg } from "./orgs";
import { listProjects, type Application, type Project } from "./resources";

interface DashboardRef {
  orgId?: string;
  applicationId?: string;
}

interface FoundApplication {
  project: Project;
  app: Application;
}

const DASHBOARD_PATH = /^\/(\d+)(?:\/(\d+))?(?:\/|$)/;

export function parseDashboardUrl(value: string): DashboardRef | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (!/(^|\.)superwall\.com$/.test(url.hostname)) return undefined;
  const match = DASHBOARD_PATH.exec(url.pathname);
  if (!match) return undefined;
  return { orgId: match[1], applicationId: match[2] };
}

function notFound(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 403);
}

export async function findProject(
  api: SuperwallApi,
  projectId: string,
  known?: readonly Project[],
): Promise<Project | undefined> {
  const local = known?.find((project) => String(project.id) === projectId);
  if (local) return local;
  try {
    const project = await api.get<Project>(`/v2/projects/${encodeURIComponent(projectId)}`);
    rememberOrg(project);
    return project;
  } catch (error) {
    if (notFound(error)) return undefined;
    throw error;
  }
}

const selectFromProjects = (
  projects: readonly Project[],
  matches: (app: Application) => boolean,
): FoundApplication | undefined => {
  for (const project of projects) {
    const app = project.applications?.find(matches);
    if (app) return { project, app };
  }
  return undefined;
};

export async function findApplication(
  api: SuperwallApi,
  ref: string,
  known?: readonly Project[],
): Promise<FoundApplication | undefined> {
  const dashboard = parseDashboardUrl(ref);
  const id = dashboard?.applicationId ?? ref;
  const byId = (app: Application) => String(app.id) === id;

  const local = selectFromProjects(
    known ?? (await listProjects(api)),
    (app) => byId(app) || app.name === ref,
  );
  if (local) return local;
  if (!/^\d+$/.test(id)) return undefined;

  const [paywall] = await api
    .get<{ data?: { project_id?: string | number }[] }>(
      `/v2/paywalls?application_id=${encodeURIComponent(id)}&limit=1`,
    )
    .then((page) => page.data ?? [])
    .catch((error: unknown) => {
      if (notFound(error)) return [];
      throw error;
    });
  if (paywall?.project_id !== undefined) {
    const project = await findProject(api, String(paywall.project_id));
    const found = project && selectFromProjects([project], byId);
    if (found) return found;
  }

  if (!dashboard?.orgId) return undefined;
  const found = selectFromProjects(await orgProjects(api, dashboard.orgId), byId);
  if (found) rememberOrg(found.project);
  return found;
}

export function appNotFound(ref: string): Error {
  return new Error(
    `No app ${ref} that this account can open. ` +
      "Pass its dashboard link instead — https://app.superwall.com/<org>/<app>/… names the organization, " +
      "which finds apps that have no paywalls yet.",
  );
}
