import type { CommandContext } from "@/program/command";
import { chooseApp, pickProject, pickScope, type PickedScope } from "@/core/account/scope";
import type { SuperwallApi } from "@/core/api/client";
import { appNotFound, findApplication } from "@/core/api/lookup";
import { listOrgGroups } from "@/core/api/orgs";
import {
  isAppScoped,
  listProjects,
  listResource,
  platformLabel,
  rowName,
  type Project,
  type RESOURCES,
  type ResourceName,
} from "@/core/api/resources";
import { readDefaultApp, writeDefaultApp } from "@/core/state/config";
import { blocks } from "@/program/output";
import { apiCall } from "@/ui/spinner";
import { textOf } from "./input";

export async function list(
  context: CommandContext,
  api: SuperwallApi,
  resource: ResourceName,
  flags: { search?: string; limit: unknown },
): Promise<void> {
  const { json } = context;

  if (resource === "apps") {
    const query = flags.search;
    let room = limitOf(flags.limit) ?? Number.POSITIVE_INFINITY;
    const groups = (await apiCall(context, "Loading projects", () => listOrgGroups(api)))
      .map((group) => {
        const projects = matchingProjects(group.projects, query).slice(0, room);
        room -= projects.length;
        return { ...group, projects };
      })
      .filter((group) => group.projects.length > 0 || (!query && room > 0));
    if (json) {
      return context.output.data(
        groups.flatMap(({ projects, ...organization }) =>
          projects.map((project) => (organization.id ? { ...project, organization } : project)),
        ),
      );
    }
    const projects = groups.flatMap((group) => group.projects);
    if (projects.length === 0) {
      return context.output.render(
        blocks.list({
          items: [],
          empty: query
            ? `No project or app matches "${query}".`
            : "No projects yet - run `superwall apps create --name <name> --platform ios`.",
        }),
      );
    }
    for (const group of groups) {
      const heading =
        groups.length > 1
          ? `\`${group.name ?? `Organization ${group.id}`}\`${group.member ? "" : " (not a member)"} · ${formatCount(group.projects.length, "project")}`
          : formatCount(group.projects.length, "project");
      context.output.render(
        blocks.step(heading),
        blocks.list({
          items: group.projects.map((project) => ({
            label: project.name ?? String(project.id),
            meta: String(project.id),
            children: (project.applications ?? []).map((app) => ({
              badge: platformLabel(app.platform),
              label: app.bundle_id ?? app.name ?? "",
              meta: `${app.id}${app.public_api_key ? `  pk_…${app.public_api_key.slice(-4)}` : ""}`,
            })),
          })),
        }),
      );
    }
    return;
  }

  const scope = await pickScope(context, api, isAppScoped(resource));
  const all = await apiCall(context, `Loading ${resource}`, () =>
    listResource(api, resource, scope),
  );
  const query = flags.search;
  const matched = query ? all.filter((row) => rowMatches(row, query)) : all;
  const limit = limitOf(flags.limit);
  if (json) return context.output.data(limit === undefined ? matched : matched.slice(0, limit));

  const shown = matched.slice(0, limit ?? RICH_ROWS);
  const noun = resource.replace(/s$/, "");
  const heading = query
    ? `${formatCount(matched.length, noun)} matching "${query}", of ${all.length}`
    : formatCount(all.length, noun);
  context.output.render(
    blocks.step(`${heading}${scopeLabel(resource, scope)}`),
    blocks.list({
      items: shown.map((row) => {
        const label = rowName(row);
        const identifier = typeof row.identifier === "string" ? row.identifier : undefined;
        const ids = [
          identifier && identifier !== label ? identifier : undefined,
          secondaryId(label, row.id),
        ];
        return { label, meta: ids.filter(Boolean).join("  ") || undefined };
      }),
      empty: query ? `No ${resource} match "${query}".` : `No ${resource} yet.`,
    }),
  );
  if (matched.length > shown.length) {
    context.ui.info(
      `…${matched.length - shown.length} more. Narrow with --search <text>, or pass --limit <n> or --json for all.`,
    );
  }
}

export async function useApp(context: CommandContext, api: SuperwallApi, value: unknown): Promise<void> {
  const projects = await apiCall(context, "Loading projects", () => listProjects(api));
  const target = textOf(value);
  let app;
  let projectId: string;
  if (target) {
    const found = await apiCall(context, "Finding the app", () =>
      findApplication(api, target, projects),
    );
    if (!found) throw appNotFound(target);
    app = found.app;
    projectId = String(found.project.id);
  } else if (!context.interactive) {
    throw new Error("Specify an app: superwall apps use <id|name|dashboard link>");
  } else {
    const project = await pickProject(context, api, projects);
    const apps = project.applications ?? [];
    const [first] = apps;
    if (!first) throw new Error(`${project.name ?? project.id} has no apps yet.`);
    projectId = String(project.id);
    const current = apps.find((candidate) => String(candidate.id) === readDefaultApp(projectId)) ?? first;
    app = await chooseApp(context, apps, current);
  }

  writeDefaultApp(projectId, String(app.id));
  if (context.json) return context.output.data(app);
  context.ui.success(
    `Default app set to \`${app.name ?? app.id}\` (${platformLabel(app.platform)})`,
  );
}

function secondaryId(label: string, id: unknown): string | undefined {
  const value = String(id ?? "");
  return value && value !== label ? value : undefined;
}

function formatCount(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

function scopeLabel(resource: keyof typeof RESOURCES, scope: PickedScope): string {
  const parts: string[] = [];
  if (scope.projectCount > 1 && scope.projectName) {
    parts.push(scope.projectName);
  }
  if (isAppScoped(resource) && scope.appCount > 1 && scope.appName) {
    parts.push(`${scope.appName} (${platformLabel(scope.appPlatform)})`);
  }
  return parts.length ? ` in \`${parts.join(" · ")}\`` : "";
}

export const RICH_ROWS = 50;

export function limitOf(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error("--limit takes a whole number above 0.");
  return n;
}

const SEARCHED_FIELDS = ["id", "name", "identifier", "bundle_id", "description", "public_api_key"];

export function rowMatches(row: object, query: string): boolean {
  const needle = query.toLowerCase();
  return Object.entries(row).some(([field, value]) => {
    return (
      SEARCHED_FIELDS.includes(field) &&
      (typeof value === "string" || typeof value === "number") &&
      String(value).toLowerCase().includes(needle)
    );
  });
}

function matchingProjects<P extends Project>(projects: P[], query: string | undefined): P[] {
  if (!query) return projects;
  return projects.flatMap((project) => {
    if (rowMatches(project, query)) return [project];
    const apps = (project.applications ?? []).filter((app) => rowMatches(app, query));
    return apps.length ? [{ ...project, applications: apps }] : [];
  });
}
