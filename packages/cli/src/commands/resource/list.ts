import type { CommandContext } from "@/command";
import { blocks } from "@/output";
import type { SuperwallApi } from "@/core/api/client";
import {
  isAppScoped,
  listOrganizations,
  listProjects,
  listResource,
  platformLabel,
  rowName,
  titleCase,
  RESOURCES,
  type ResourceName,
} from "@/core/api/resources";
import { getDefaultApp, setDefaultApp } from "@/core/state/config";
import { apiCall } from "@/util/api-output";
import { chooseApp, pickProject, pickScope, type PickedScope } from "./scope";

export async function list(
  context: CommandContext,
  api: SuperwallApi,
  resource: ResourceName,
): Promise<void> {
  const { json } = context;

  if (resource === "orgs") {
    const organizations = await apiCall(context, "Loading organizations", () =>
      listOrganizations(api),
    );
    if (json) return context.output.data(organizations);
    context.output.render(
      blocks.step(count(organizations.length, "organization")),
      blocks.list({
        items: organizations.map((organization) => {
          const label = rowName(organization);
          return {
            label,
            badge: titleCase(String(organization.role ?? "")),
            meta: secondaryId(label, organization.id),
          };
        }),
        empty: "No organizations.",
      }),
    );
    return;
  }

  if (resource === "projects" || resource === "apps") {
    const projects = await apiCall(context, "Loading projects", () => listProjects(api));
    if (json) return context.output.data(projects);
    context.output.render(
      blocks.step(`${count(projects.length, "project")}${orgLabel(api)}`),
      blocks.list({
        items: projects.map((project) => ({
          label: project.name ?? String(project.id),
          meta: String(project.id),
          children: (project.applications ?? []).map((app) => ({
            badge: platformLabel(app.platform),
            label: app.bundle_id ?? app.name ?? "",
            meta: app.public_api_key ? `pk_…${app.public_api_key.slice(-4)}` : "(no key)",
          })),
        })),
        empty: "No projects yet - run `superwall apps create <name> --platform ios`.",
      }),
    );
    return;
  }

  const scope = await pickScope(context, api, isAppScoped(resource as keyof typeof RESOURCES));
  const rows = await apiCall(context, `Loading ${resource}`, () =>
    listResource(api, resource, scope),
  );
  if (json) return context.output.data(rows);
  context.output.render(
    blocks.step(`${count(rows.length, resource.replace(/s$/, ""))}${scopeLabel(resource, scope)}`),
    blocks.list({
      items: rows.map((row) => {
        const label = rowName(row);
        return { label, meta: secondaryId(label, row.id) };
      }),
      empty: `No ${resource} yet.`,
    }),
  );
}

export async function useApp(context: CommandContext, api: SuperwallApi): Promise<void> {
  const projects = await apiCall(context, "Loading projects", () => listProjects(api));
  const project = await pickProject(context, projects);
  const apps = project.applications ?? [];
  if (apps.length === 0) {
    throw new Error(`${project.name ?? project.id} has no apps yet.`);
  }

  const target = context.argv.value as string | undefined;
  let app;
  if (target) {
    app = apps.find((candidate) => String(candidate.id) === target || candidate.name === target);
    if (!app) {
      throw new Error(`No app ${target} in ${project.name ?? project.id}.`);
    }
  } else if (!context.interactive) {
    throw new Error("Specify an app: superwall apps use <id|name>");
  } else {
    const current =
      apps.find((candidate) => String(candidate.id) === getDefaultApp(String(project.id))) ??
      apps[0]!;
    app = await chooseApp(context, apps, current);
  }

  setDefaultApp(String(project.id), String(app.id));
  if (context.json) return context.output.data(app);
  context.ui.success(
    `Default app set to \`${app.name ?? app.id}\` (${platformLabel(app.platform)})`,
  );
}

export async function useOrg(context: CommandContext, api: SuperwallApi): Promise<void> {
  const organizations = await apiCall(context, "Loading organizations", () =>
    listOrganizations(api),
  );
  if (organizations.length === 0) {
    throw new Error("Your account has no organizations.");
  }

  const target = context.argv.value as string | undefined;
  let org;
  if (target) {
    org = organizations.find(
      (candidate) => String(candidate.id) === target || rowName(candidate) === target,
    );
    if (!org) throw new Error(`No organization ${target}.`);
  } else if (!context.interactive) {
    throw new Error("Specify an organization: superwall orgs use <id|name>");
  } else {
    const sel = await context.ui.select({
      message: "Which organization?",
      options: organizations.map((candidate) => ({
        value: String(candidate.id),
        label: rowName(candidate),
        hint: titleCase(String(candidate.role ?? "")),
      })),
      initialValue: api.org.id,
    });
    if (sel === null) return;
    org = organizations.find((candidate) => String(candidate.id) === sel)!;
  }

  api.setOrg({ id: String(org.id), name: rowName(org) });
  if (context.json) return context.output.data(org);
  context.ui.success(`Organization set to \`${rowName(org)}\`.`);
}

function secondaryId(label: string, id: unknown): string | undefined {
  const value = String(id ?? "");
  return value && value !== label ? value : undefined;
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

function orgLabel(api: SuperwallApi): string {
  return api.org.count > 1 && api.org.name ? ` in \`${api.org.name}\`` : "";
}

function scopeLabel(resource: ResourceName, scope: PickedScope): string {
  const parts: string[] = [];
  if (scope.projectCount > 1 && scope.projectName) {
    parts.push(scope.projectName);
  }
  if (isAppScoped(resource as keyof typeof RESOURCES) && scope.appCount > 1 && scope.appName) {
    parts.push(`${scope.appName} (${platformLabel(scope.appPlatform)})`);
  }
  return parts.length ? ` in \`${parts.join(" · ")}\`` : "";
}
