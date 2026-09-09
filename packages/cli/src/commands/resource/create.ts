import type { Arguments } from "yargs";
import type { CommandContext } from "@/command";
import { requireOrg } from "@/core/account/org";
import { platformForIntegration } from "@/core/account/bind";
import { ApiError, type SuperwallApi } from "@/core/api/client";
import {
  createApplication,
  createCampaign,
  createEntitlement,
  createProduct,
  createProject,
  isAppScoped,
  platformLabel,
  RESOURCES,
  rowName,
  type ProductCreateOpts,
  type ResourceName,
  type Row,
  type Scope,
  type SubscriptionPeriod,
} from "@/core/api/resources";
import { scanProject } from "@/core/project/scan";
import { apiCall } from "@/commands/api-output";
import { pickScope } from "./scope";

export async function create(
  context: CommandContext,
  api: SuperwallApi,
  resource: ResourceName,
): Promise<void> {
  const { ui, json, dryRun, argv } = context;
  const value = argv.value as string | undefined;

  if (resource === "apps") {
    return createApp(context, api, value);
  }

  if (!value) {
    throw new Error(
      resource === "campaigns"
        ? 'Usage: superwall campaigns create "<description>" <placement>'
        : `Usage: superwall ${resource} create <${createArgLabel(resource)}>`,
    );
  }
  if (resource === "campaigns" && !argv.value2) {
    throw new Error(
      'Usage: superwall campaigns create "<description>" <placement>  (campaigns need at least one placement)',
    );
  }

  const scope = await pickScope(context, api, isAppScoped(resource as keyof typeof RESOURCES));
  if (dryRun) {
    const plan = { dryRun: true, action: "create", resource, value, scope };
    if (json) return context.output.data(plan);
    ui.info(
      `[dry-run] would create ${resource.replace(/s$/, "")} "${value}" in ${scope.projectName ?? scope.projectId}`,
    );
    return;
  }

  const created = await apiCall(context, `Creating ${resource.replace(/s$/, "")}`, () =>
    createOne(api, resource, scope, value, argv),
  );
  if (json) return context.output.data(created);
  ui.success(`Created ${resource.replace(/s$/, "")} \`${rowName(created)}\` ${created.id ?? ""}`);
}

const APP_PLATFORMS = ["ios", "android", "flutter", "react_native", "web"] as const;

async function createApp(
  context: CommandContext,
  api: SuperwallApi,
  nameArg: string | undefined,
): Promise<void> {
  const { argv, dryRun, json, ui, interactive } = context;

  let name = nameArg;
  let platform = argv.platform as string | undefined;

  if (interactive && (!name || !platform)) {
    const detected = (await scanProject(context.installDir).catch(() => null))?.apps[0];
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
      "Usage: superwall apps create <name> --platform <ios|android|flutter|react_native|web> [--bundle <id>] [--project <projectId>]",
    );
  }

  const bundle = argv.bundle as string | undefined;
  const target = argv.project as string | undefined;
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
    await requireOrg(api, context.interactive);
    projectId = String(
      (await apiCall(context, `Creating project "${name}"`, () => createProject(api, name))).id,
    );
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
    project = (await apiCall(context, `Adding ${platformLabel(platform)} app`, () =>
      createApplication(
        api,
        { projectId },
        {
          name,
          platform,
          bundleId: bundle,
        },
      ),
    )) as typeof project;
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
  argv: Arguments,
): Promise<Row> {
  switch (resource) {
    case "entitlements":
      return createEntitlement(api, scope, value);
    case "products":
      return createProduct(api, scope, value, productOptsFromArgv(argv));
    case "campaigns": {
      return createCampaign(api, scope, value, String(argv.value2));
    }
    default:
      throw new Error(`create is not supported for ${resource} yet.`);
  }
}

function productOptsFromArgv(argv: Arguments): ProductCreateOpts {
  const options: ProductCreateOpts = {};
  if (argv.name) options.name = String(argv.name);
  if (argv.price !== undefined) {
    options.price = {
      amount: Math.round(Number(argv.price) * 100),
      currency: String(argv.currency ?? "USD").toUpperCase(),
    };
  }
  if (argv.period) {
    options.subscription = {
      period: String(argv.period) as SubscriptionPeriod,
      period_count: argv.periodCount !== undefined ? Number(argv.periodCount) : 1,
      ...(argv.trialDays !== undefined ? { trial_period_days: Number(argv.trialDays) } : {}),
    };
  }
  const entitlement = argv.entitlement;
  const entitlements = Array.isArray(entitlement)
    ? entitlement.map(String)
    : entitlement
      ? [String(entitlement)]
      : [];
  if (entitlements.length) options.entitlements = entitlements;
  return options;
}

function createArgLabel(resource: ResourceName): string {
  return resource === "campaigns" ? "description" : "identifier";
}
