import { ApiError, type SuperwallApi } from "./client";
import type { Project, Row } from "./resources";
import { getOpenedOrgs, setOpenedOrgs } from "@/core/state/config";

export interface OrgGroup {
  id: string;
  name?: string;
  member: boolean;
  projects: Project[];
}

export async function listOrganizations(api: SuperwallApi): Promise<Row[]> {
  const res = await api.get<{ data?: Row[] }>("/v2/me/organizations");
  const byId = new Map((res.data ?? []).map((org) => [String(org.id), org]));
  return [...byId.values()];
}

export function orgProjects(api: SuperwallApi, orgId: string): Promise<Project[]> {
  return api
    .list<Project>(`/v2/projects?organization_id=${encodeURIComponent(orgId)}`)
    .then((projects) => projects.map((project) => ({ organization_id: orgId, ...project })));
}

export const orgIdOf = (project: Project): string | undefined =>
  project.organization_id === undefined ? undefined : String(project.organization_id);

const asksForOrg = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 400 && /organization_id/.test(error.message);

// Organizations opened by id or link aren't memberships, so the CLI remembers them and lists them too.
export async function listReachableProjects(api: SuperwallApi): Promise<Project[]> {
  let members = await api.list<Project>("/v2/projects").catch(async (error: unknown) => {
    if (!asksForOrg(error)) throw error;
    const orgs = await listOrganizations(api);
    return (await Promise.all(orgs.map((org) => orgProjects(api, String(org.id))))).flat();
  });

  members = unique(members);
  const seen = new Set(members.map(orgIdOf).filter((id): id is string => id !== undefined));
  const opened = getOpenedOrgs().filter((id) => !seen.has(id));
  if (opened.length === 0) return members;

  const reached = await Promise.all(
    opened.map((id) =>
      orgProjects(api, id).catch((error: unknown) => {
        if (error instanceof ApiError && [400, 403, 404].includes(error.status)) return [];
        throw error;
      }),
    ),
  );
  setOpenedOrgs(opened.filter((_, index) => reached[index]!.length > 0));
  return [...members, ...reached.flat()];
}

function unique(projects: Project[]): Project[] {
  return [...new Map(projects.map((project) => [String(project.id), project])).values()];
}

export function rememberOrg(project: Project | undefined): void {
  const id = project && orgIdOf(project);
  if (id) setOpenedOrgs([...getOpenedOrgs(), id]);
}

export async function listOrgGroups(api: SuperwallApi): Promise<OrgGroup[]> {
  const [projects, memberships] = await Promise.all([
    listReachableProjects(api),
    listOrganizations(api).catch((): Row[] => []),
  ]);
  const members = new Map(memberships.map((org) => [String(org.id), org]));
  const groups = new Map<string, OrgGroup>();
  for (const project of projects) {
    const id = orgIdOf(project) ?? "";
    const group = groups.get(id) ?? {
      id,
      name: members.get(id)?.name as string | undefined,
      member: members.has(id) || id === "",
      projects: [],
    };
    group.projects.push(project);
    groups.set(id, group);
  }
  await Promise.all(
    [...groups.values()]
      .filter((group) => !group.member && !group.name)
      .map(async (group) => {
        const org = await api
          .get<Row>(`/v2/organizations/${encodeURIComponent(group.id)}`)
          .catch(() => undefined);
        if (typeof org?.name === "string") group.name = org.name;
      }),
  );
  return [...groups.values()].sort((a, b) => Number(b.member) - Number(a.member));
}

export async function organizationOf(
  api: SuperwallApi,
  projectId: string,
  known?: readonly Project[],
): Promise<string> {
  const local = known?.find((project) => String(project.id) === projectId);
  const id =
    (local && orgIdOf(local)) ??
    orgIdOf(await api.get<Project>(`/v2/projects/${encodeURIComponent(projectId)}`));
  if (!id) throw new Error(`Couldn't tell which account project ${projectId} belongs to.`);
  return id;
}
