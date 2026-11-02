import type { CommandContext } from "@/program/command";
import { platformForIntegration } from "@/core/account/bind";
import { orgForNewProject } from "@/core/account/org";
import { boundOrganization, pickScope, type PickedScope } from "@/core/account/scope";
import { ApiError, type SuperwallApi } from "@/core/api/client";
import { findProject } from "@/core/api/lookup";
import {
  createApplication,
  createCampaign,
  createEntitlement,
  createProduct,
  createProject,
  isAppScoped,
  listResource,
  platformLabel,
  rowName,
  type Application,
  type ProductCreateOpts,
  type ResourceName,
  type Row,
  type SubscriptionPeriod,
} from "@/core/api/resources";
import { apiCall } from "@/ui/spinner";
import { textOf, type ResourceFlags } from "./input";

export async function create(
  context: CommandContext,
  api: SuperwallApi,
  resource: ResourceName,
  rawValue: unknown,
  value2: unknown,
  flags: ResourceFlags,
): Promise<void> {
  const { ui, json, dryRun } = context;
  const value = textOf(rawValue);
  if (resource === "apps") return createApp(context, api, value, flags.fields);

  if (!value) {
    throw new Error(
      resource === "campaigns"
        ? 'Usage: superwall campaigns create --description "<description>" --placement <placement>'
        : `Usage: superwall ${resource} create --identifier <identifier>`,
    );
  }
  if (resource === "campaigns" && !value2) {
    throw new Error(
      'Usage: superwall campaigns create --description "<description>" --placement <placement>  (campaigns need at least one placement)',
    );
  }

  const scope = await pickScope(
    context,
    api,
    isAppScoped(resource) || (resource === "products" && context.target.app !== undefined),
  );
  const grants =
    resource === "products" ? await productEntitlements(context, api, scope, entitlementValues(flags.fields)) : undefined;
  if (dryRun) {
    const { projectCount: _projects, appCount: _apps, ...where } = scope;
    const plan = {
      dryRun: true,
      action: "create",
      resource,
      value,
      scope: grants?.app ? { ...where, applicationId: String(grants.app.id) } : where,
      ...(grants?.ids.length ? { entitlements: grants.ids } : {}),
    };
    if (json) return context.output.data(plan);
    const target = grants?.app
      ? appLabel(grants.app)
      : scope.applicationId
        ? `${scope.appName ?? scope.applicationId} (${platformLabel(scope.appPlatform)})`
        : resource === "entitlements" && scope.boundApplicationId
          ? `${scope.projectName ?? scope.projectId}, app ${scope.boundApplicationId}`
          : (scope.projectName ?? scope.projectId);
    const granting = grants?.ids.length ? ` granting entitlement ${grants.ids.join(", ")}` : "";
    ui.info(`[dry-run] would create ${resource.replace(/s$/, "")} "${value}" in ${target}${granting}`);
    return;
  }

  const created = await apiCall(context, `Creating ${resource.replace(/s$/, "")}`, () => {
    return createOne(api, resource, scope, value, value2, flags.fields, grants);
  });
  if (json) return context.output.data(created);
  ui.success(`Created ${resource.replace(/s$/, "")} \`${rowName(created)}\` ${created.id ?? ""}`);
}

const APP_PLATFORMS = ["ios", "android", "flutter", "react_native", "web"] as const;

async function createApp(
  context: CommandContext,
  api: SuperwallApi,
  nameArg: string | undefined,
  fields: Record<string, unknown>,
): Promise<void> {
  const { dryRun, json, ui, interactive } = context;
  let name = nameArg;
  let platform = textOf(fields.platform);

  if (interactive && (!name || !platform)) {
    const { scanProject } = await import("@/core/codebase/scan");
    const scan = await scanProject(context.installDir).catch(() => null);
    const detected = scan?.apps[0];
    if (detected && !name && !platform) {
      ui.info(
        `Detected \`${detected.framework.name}\`` +
          (detected.details ? ` · \`${detected.details}\`` : ""),
      );
      const ok = await ui.confirm({
        message: `Create \`${detected.name}\` in Superwall?`,
      });
      if (ok === null) return void ui.warn("Cancelled.");
      if (ok) {
        name = detected.name;
        platform = platformForIntegration(detected.integration);
      }
    }
    if (!name) {
      const answer = await ui.text({
        message: "What's your app called?",
        placeholder: "My App",
        initialValue: detected?.name,
        validate: (v) => (v?.trim() ? undefined : "Required"),
      });
      if (answer === null) return void ui.warn("Cancelled.");
      name = answer.trim();
    }
    if (!platform) {
      const answer = await ui.select({
        message: "Which platform?",
        options: APP_PLATFORMS.map((p) => ({
          value: p,
          label: platformLabel(p),
        })),
        initialValue: detected ? platformForIntegration(detected.integration) : "ios",
      });
      if (answer === null) return void ui.warn("Cancelled.");
      platform = answer;
    }
  }

  if (!name || !platform) {
    throw new Error(
      "Usage: superwall apps create --name <name> --platform <ios|android|flutter|react_native|web> [--bundle-id <id>] [--project <projectId>]",
    );
  }

  const bundle = textOf(fields.bundleId);
  const target = context.target.project;
  if (dryRun) {
    const plan = {
      dryRun: true,
      action: "create",
      resource: "apps",
      name,
      platform,
      project: target ?? null,
    };
    if (json) return context.output.data(plan);
    ui.info(
      `[dry-run] would add ${platformLabel(platform)} app "${name}" to ${target ? `project ${target}` : "a new project"}`,
    );
    return;
  }

  let projectId = target;
  if (!projectId) {
    const organizationId =
      (await boundOrganization(context, api)) ?? (await orgForNewProject(api, context.interactive));
    const created = await apiCall(context, `Creating project "${name}"`, () => {
      return createProject(api, name, organizationId);
    });
    projectId = String(created.id);
  }
  let project: Row & {
    name?: string;
    applications?: Array<{
      name?: string;
      platform?: string;
      public_api_key?: string;
    }>;
  };
  try {
    const saved = await apiCall(context, `Adding ${platformLabel(platform)} app`, () => {
      return createApplication(api, { projectId }, { name, platform, bundleId: bundle });
    });
    project = saved as typeof project;
  } catch (error) {
    if (
      error instanceof ApiError &&
      /already[_ ]?exists|Duplicate entry|projectId_platform/i.test(error.body ?? "")
    ) {
      throw new Error(
        `Project ${projectId} already has a ${platformLabel(platform)} app - each project allows one app per platform.`,
      );
    }
    throw error;
  }

  if (json) return context.output.data(project);
  const created =
    project.applications?.find((app) => app.name === name && app.platform === platform) ??
    project.applications?.find((app) => app.platform === platform) ??
    project.applications?.at(-1);
  const key = created?.public_api_key ? ` · \`pk_…${created.public_api_key.slice(-4)}\`` : "";
  const projectLabel = project.name ? ` in \`${project.name}\`` : "";
  ui.success(`Added \`${platformLabel(platform)}\` app \`${name}\`${projectLabel}${key}`);
}

function createOne(
  api: SuperwallApi,
  resource: ResourceName,
  scope: PickedScope,
  value: string,
  value2: unknown,
  fields: Record<string, unknown>,
  grants: ProductEntitlements | undefined,
): Promise<Row> {
  switch (resource) {
    case "entitlements":
      return createEntitlement(api, scope, value, scope.boundApplicationId);
    case "products": {
      const applicationId = grants?.app ? String(grants.app.id) : scope.applicationId;
      return createProduct(api, scope, value, {
        ...productOptions(fields),
        ...(applicationId ? { applicationId } : {}),
        ...(grants?.ids.length ? { entitlements: grants.ids } : {}),
      });
    }
    case "campaigns": {
      return createCampaign(api, scope, value, String(value2));
    }
    default:
      throw new Error(`create is not supported for ${resource} yet.`);
  }
}

function productOptions(fields: Record<string, unknown>): ProductCreateOpts {
  const options: ProductCreateOpts = {};
  if (fields.name) options.name = String(fields.name);
  if (fields.price !== undefined) {
    options.price = {
      amount: Math.round(Number(fields.price) * 100),
      currency: String(fields.currency ?? "USD").toUpperCase(),
    };
  }
  if (fields.period) {
    options.subscription = {
      period: String(fields.period) as SubscriptionPeriod,
      period_count: fields.periodCount !== undefined ? Number(fields.periodCount) : 1,
      ...(fields.trialDays !== undefined ? { trial_period_days: Number(fields.trialDays) } : {}),
    };
  }
  return options;
}

interface ProductEntitlements {
  app?: Application;
  ids: string[];
}

const NATIVE_PLATFORMS = new Set(["ios", "android"]);
const ANY_NATIVE_PLATFORMS = new Set(["stripe", "web", "webapp", "custom"]);

function entitlementValues(fields: Record<string, unknown>): string[] {
  const raw = fields.entitlement;
  const values = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  return values.map((value) => String(value).trim()).filter(Boolean);
}

function appLabel(app: Application): string {
  return `${app.name ?? app.id} (${platformLabel(app.platform)})`;
}

function grantsFrom(product: Application, entitlementApp: Application | undefined): boolean {
  if (ANY_NATIVE_PLATFORMS.has((product.platform ?? "").toLowerCase())) {
    return NATIVE_PLATFORMS.has((entitlementApp?.platform ?? "").toLowerCase());
  }
  return entitlementApp !== undefined && String(entitlementApp.id) === String(product.id);
}

async function productEntitlements(
  context: CommandContext,
  api: SuperwallApi,
  scope: PickedScope,
  values: string[],
): Promise<ProductEntitlements> {
  if (values.length === 0) return { ids: [] };
  const project = await findProject(api, scope.projectId);
  const apps = project?.applications ?? [];
  const rows = await apiCall(context, "Loading entitlements", () => listResource(api, "entitlements", scope));
  const projectLabel = scope.projectName ?? `Project ${scope.projectId}`;
  const appOf = (row: Row): Application | undefined => {
    const id = row.application_id;
    if (id === undefined || id === null) return undefined;
    return apps.find((app) => String(app.id) === String(id)) ?? { id: String(id) };
  };
  const describe = (row: Row): string => {
    const app = appOf(row);
    const name = row.identifier ? ` (${String(row.identifier)})` : "";
    return `${String(row.id)}${name} is on ${app ? appLabel(app) : "no app"}`;
  };

  const wanted = values.map((value) => {
    const byId = rows.filter((row) => String(row.id) === value);
    const found = byId.length > 0 ? byId : rows.filter((row) => row.identifier === value);
    if (found.length === 0) {
      throw new Error(
        `${projectLabel} has no entitlement "${value}" - create it first: superwall entitlements create --identifier ${value} --app <app>`,
      );
    }
    return found;
  });

  const fits = (app: Application): boolean => wanted.every((found) => found.some((row) => grantsFrom(app, appOf(row))));
  const named = scope.applicationId
    ? (apps.find((app) => String(app.id) === scope.applicationId) ?? {
        id: scope.applicationId,
        name: scope.appName,
        platform: scope.appPlatform,
      })
    : undefined;
  const nativeApps = [
    ...apps.filter((app) => (app.platform ?? "").toLowerCase() === "ios"),
    ...apps.filter((app) => (app.platform ?? "").toLowerCase() === "android"),
  ];
  const product = named ?? nativeApps.find(fits);

  if (!product) {
    const spread = wanted.map((found) => found.map(describe).join(", ")).join("; ");
    throw new Error(
      `No app of ${projectLabel} can grant all of these entitlements: ${spread}. ` +
        "An iOS or Android product grants only its own app's entitlements - pass --app <id>, " +
        "or create the missing ones there: superwall entitlements create --identifier <identifier> --app <id>",
    );
  }

  const ids = wanted.map((found) => {
    const granted = found.filter((candidate) => grantsFrom(product, appOf(candidate)));
    const row = granted.find((candidate) => String(appOf(candidate)?.id) === String(product.id)) ?? granted[0];
    if (row) return String(row.id);
    const [first] = found as [Row];
    const owner = appOf(first);
    const identifier = String(first.identifier ?? "<identifier>");
    if (ANY_NATIVE_PLATFORMS.has((product.platform ?? "").toLowerCase())) {
      throw new Error(
        `Entitlement ${describe(first)} - ${appLabel(product)} products grant only iOS or Android entitlements: ` +
          `superwall entitlements create --identifier ${identifier} --app <ios or android app>`,
      );
    }
    const move =
      owner && NATIVE_PLATFORMS.has((owner.platform ?? "").toLowerCase())
        ? `pass --app ${String(owner.id)} to create the product there, or `
        : "";
    throw new Error(
      `Entitlement ${describe(first)}, not ${appLabel(product)} - ${move}create it on ${product.name ?? product.id}: ` +
        `superwall entitlements create --identifier ${identifier} --app ${String(product.id)}`,
    );
  });
  return { app: product, ids: [...new Set(ids)] };
}
