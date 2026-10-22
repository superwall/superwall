import pc from "picocolors";
import { ApiError, type SuperwallApi } from "@/core/api/client";
import { appNotFound, findApplication, findProject } from "@/core/api/lookup";
import { listOrgGroups, orgIdOf } from "@/core/api/orgs";
import {
  listResource,
  platformLabel,
  rowName,
  type Application,
  type Project,
  type Row,
} from "@/core/api/resources";

interface OrgTree extends Row {
  projects: ProjectTree[];
}

interface ProjectTree extends Project {
  products: Row[];
  entitlements: Row[];
  applications_full: AppTree[];
}

interface AppTree extends Application {
  campaigns: Row[];
  paywalls: Row[];
}

const BOOTSTRAP_CONCURRENCY = 8;

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  const queue = items.entries();
  const worker = async () => {
    for (const [index, item] of queue) out[index] = await fn(item);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function orEmpty(rows: Promise<Row[]>): Promise<Row[]> {
  return rows.catch((error: unknown) => {
    if (error instanceof ApiError && [403, 404].includes(error.status)) return [];
    throw error;
  });
}

async function resolveScopedProject(api: SuperwallApi, only: { app?: string; project?: string }) {
  if (only.app) {
    const found = await findApplication(api, only.app);
    if (!found) throw appNotFound(only.app);
    return found.project;
  }
  if (!only.project) return undefined;
  const project = await findProject(api, only.project);
  if (!project) throw new Error(`No project ${only.project} that this account can open.`);
  return project;
}

export async function buildAccountTree(
  api: SuperwallApi,
  only: { app?: string; project?: string },
): Promise<{ organizations: OrgTree[] }> {
  const scoped = await resolveScopedProject(api, only);
  let groups = await listOrgGroups(api);
  if (scoped) {
    const orgId = orgIdOf(scoped) ?? "";
    const group = groups.find((candidate) => candidate.id === orgId) ?? {
      id: orgId,
      member: false,
    };
    groups = [{ ...group, projects: [scoped] }];
  }

  const organizations: OrgTree[] = [];
  for (const { projects, ...org } of groups) {
    const full = await mapLimit(
      projects,
      BOOTSTRAP_CONCURRENCY,
      async (p): Promise<ProjectTree> => {
        const scope = { projectId: String(p.id) };
        const [products, entitlements, apps] = await Promise.all([
          orEmpty(listResource(api, "products", scope)),
          orEmpty(listResource(api, "entitlements", scope)),
          Promise.all(
            (p.applications ?? []).map(async (a): Promise<AppTree> => {
              const appScope = { ...scope, applicationId: String(a.id) };
              const [campaigns, paywalls] = await Promise.all([
                orEmpty(listResource(api, "campaigns", appScope)),
                orEmpty(listResource(api, "paywalls", appScope)),
              ]);
              return { ...a, campaigns, paywalls };
            }),
          ),
        ]);
        return { ...p, products, entitlements, applications_full: apps };
      },
    );
    organizations.push({ ...org, projects: full });
  }
  return { organizations };
}

interface TreeNode {
  label: string;
  children?: TreeNode[];
}

function renderTree(nodes: TreeNode[], prefix = ""): string[] {
  return nodes.flatMap((node, i) => {
    const last = i === nodes.length - 1;
    const line = `${prefix}${last ? "└── " : "├── "}${node.label}`;
    const childPrefix = `${prefix}${last ? "    " : "│   "}`;
    return [line, ...renderTree(node.children ?? [], childPrefix)];
  });
}

const id = (row: { id?: unknown }) => pc.dim(`#${row.id}`);

function group(name: string, rows: Row[], child: (r: Row) => TreeNode): TreeNode {
  return {
    label: rows.length ? `${name} ${pc.dim(`(${rows.length})`)}` : pc.dim(`${name} (0)`),
    children: rows.map(child),
  };
}

function orgNode(org: OrgTree): TreeNode {
  return {
    label: `${pc.bold(rowName(org))}  ${id(org)}${org.member === false ? pc.dim(" · not a member") : ""}`,
    children: org.projects.map(projectNode),
  };
}

function projectNode(p: ProjectTree): TreeNode {
  const claimed = new Set<unknown>();
  const apps = p.applications_full.map((a) => {
    const products = p.products.filter(
      (r) => String(r.platform ?? "") === String(a.platform ?? ""),
    );
    for (const r of products) claimed.add(r.id);
    return appNode(a, products, p.entitlements);
  });
  const leftover = p.products.filter((r) => !claimed.has(r.id));
  return {
    label: `${pc.bold(p.name ?? String(p.id))}  ${id(p)}`,
    children: [
      ...apps,
      ...(leftover.length
        ? [
            group("products (no app)", leftover, (r) => ({
              label: `${rowName(r)}  ${id(r)}`,
            })),
          ]
        : []),
    ],
  };
}

function appNode(a: AppTree, products: Row[], entitlements: Row[]): TreeNode {
  const key = a.public_api_key ? pc.dim(`pk_…${a.public_api_key.slice(-4)}`) : id(a);
  return {
    label: `${platformLabel(a.platform)} · ${a.bundle_id ?? a.name ?? a.id}  ${key}`,
    children: [
      group("campaigns", a.campaigns, campaignNode),
      group("paywalls", a.paywalls, (r) => ({
        label: `${rowName(r)}  ${id(r)}`,
      })),
      group("products", products, (r) => ({
        label: `${rowName(r)}  ${id(r)}`,
      })),
      group("entitlements", entitlements, (r) => ({
        label: `${rowName(r)}  ${id(r)}`,
      })),
    ],
  };
}

function campaignNode(c: Row): TreeNode {
  const placements = (c.placements as Array<Record<string, unknown>> | undefined) ?? [];
  return {
    label: `${String(c.description ?? rowName(c))}  ${id(c)}`,
    children: placements.map((p) => ({
      label: `${String(p.event_name ?? p.id)}${p.enabled === false ? pc.dim(" · disabled") : ""}`,
    })),
  };
}

export function renderAccountTree(tree: { organizations: OrgTree[] }): string {
  return tree.organizations.flatMap((org) => renderTree([orgNode(org)])).join("\n");
}
