import type { CommandContext } from "@/program/command";
import { platformForIntegration } from "@/core/account/bind";
import { orgForNewProject } from "@/core/account/org";
import { boundOrganization, pickScope } from "@/core/account/scope";
import { ApiError, type SuperwallApi } from "@/core/api/client";
import {
  createApplication,
  createCampaign,
  createEntitlement,
  createProduct,
  createProject,
  isAppScoped,
  platformLabel,
  rowName,
  type ProductCreateOpts,
  type ResourceName,
  type Row,
  type Scope,
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
  if (dryRun) {
    const { projectCount: _projects, appCount: _apps, ...where } = scope;
    const plan = { dryRun: true, action: "create", resource, value, scope: where };
    if (json) return context.output.data(plan);
    const target = scope.applicationId
      ? `${scope.appName ?? scope.applicationId} (${platformLabel(scope.appPlatform)})`
      : (scope.projectName ?? scope.projectId);
    ui.info(`[dry-run] would create ${resource.replace(/s$/, "")} "${value}" in ${target}`);
    return;
  }

  const created = await apiCall(context, `Creating ${resource.replace(/s$/, "")}`, () => {
    return createOne(api, resource, scope, value, value2, flags.fields);
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
  scope: Scope,
  value: string,
  value2: unknown,
  fields: Record<string, unknown>,
): Promise<Row> {
  switch (resource) {
    case "entitlements":
      return createEntitlement(api, scope, value);
    case "products":
      return createProduct(api, scope, value, {
        ...productOptions(fields),
        ...(scope.applicationId ? { applicationId: scope.applicationId } : {}),
      });
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
  const entitlement = fields.entitlement;
  const entitlements = Array.isArray(entitlement) ? entitlement.map(String) : [];
  if (entitlements.length) options.entitlements = entitlements;
  return options;
}
