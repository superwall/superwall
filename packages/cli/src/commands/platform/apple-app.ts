import type { CommandContext } from "@/command";
import type { SuperwallApi } from "@/core/api/client";
import { findApp, listApps, type AppleApp } from "@/core/apple/apps";
import type { AppleSession } from "@/core/apple/session";
import {
  createApplication,
  createProject,
  listProjects,
  type Application,
  type Project,
} from "@/core/api/resources";
import { blocks } from "@/output";
import { apiCall } from "@/commands/api-output";

export interface AppFlags {
  app?: string;
  project?: string;
  bundleId?: string;
}

export type AppIntent =
  | { kind: "existing"; project: Project; app: Application }
  | { kind: "create"; project?: Project };

export interface ResolvedApp {
  projectId: string;
  applicationId: string;
  name: string;
  bundleId: string;
  ascAppId: string;
  created: boolean;
}

const NEW_APP = "__new__";
const LISTED_APPS = 8;

const isIos = (app: Application): boolean => (app.platform ?? "").toLowerCase() === "ios";

interface IosApp {
  project: Project;
  app: Application;
}

async function iosApps(
  ctx: CommandContext,
  api: SuperwallApi,
  flags: AppFlags,
): Promise<{ scoped: Project[]; candidates: IosApp[]; named?: IosApp }> {
  const projects = await apiCall(ctx, "Loading your apps", () => listProjects(api));
  const scoped = flags.project
    ? projects.filter((project) => String(project.id) === flags.project)
    : projects;
  if (flags.project && scoped.length === 0) {
    throw new Error(`No project ${flags.project} in this organization.`);
  }
  const candidates = scoped.flatMap((project) =>
    (project.applications ?? []).filter(isIos).map((app) => ({ project, app })),
  );
  if (!flags.app) return { scoped, candidates };
  const named = candidates.find(
    ({ app }) => String(app.id) === flags.app || app.name === flags.app,
  );
  if (!named) throw new Error(`No iOS app ${flags.app} in this organization.`);
  return { scoped, candidates, named };
}

function severalApps(candidates: IosApp[]): Error {
  const shown = candidates
    .slice(0, LISTED_APPS)
    .map(({ app }) => `${app.id} (${app.name ?? "unnamed"})`)
    .join(", ");
  const more =
    candidates.length > LISTED_APPS
      ? `, and ${candidates.length - LISTED_APPS} more (\`superwall apps\` lists them all)`
      : "";
  return new Error(`Several iOS apps found: ${shown}${more}. Pass --app <id>.`);
}

const appOptions = (candidates: IosApp[]) =>
  candidates.map(({ app, project }) => ({
    value: String(app.id),
    label: app.name ?? String(app.id),
    hint: app.bundle_id ?? project.name,
  }));

export async function chooseIosApp(
  ctx: CommandContext,
  api: SuperwallApi,
  flags: AppFlags,
): Promise<IosApp> {
  const { candidates, named } = await iosApps(ctx, api, flags);
  if (named) return named;
  if (candidates.length === 0) {
    throw new Error(
      "There's no iOS app in Superwall yet. Create one with `superwall apps create`, or run `superwall setup apple`.",
    );
  }
  if (candidates.length === 1) return candidates[0]!;
  if (!ctx.interactive) throw severalApps(candidates);
  const picked = await ctx.ui.select({
    message: "Which Superwall app?",
    options: appOptions(candidates),
  });
  if (picked === null) throw new Error("Cancelled.");
  return candidates.find(({ app }) => String(app.id) === picked)!;
}

export async function chooseAppIntent(
  ctx: CommandContext,
  api: SuperwallApi,
  flags: AppFlags,
): Promise<AppIntent> {
  const { scoped, candidates, named } = await iosApps(ctx, api, flags);
  if (named) return { kind: "existing", ...named };

  const createIn = scoped.length === 1 ? scoped[0] : undefined;
  if (candidates.length === 0) {
    if (!ctx.interactive && !flags.bundleId) {
      throw new Error(
        "There's no iOS app in Superwall yet. Pass --bundle-id <id> to create one for that App Store Connect app.",
      );
    }
    return { kind: "create", project: createIn };
  }
  if (flags.bundleId) {
    const found = candidates.find(({ app }) => app.bundle_id === flags.bundleId);
    return found ? { kind: "existing", ...found } : { kind: "create", project: createIn };
  }
  if (!ctx.interactive) {
    if (candidates.length === 1) return { kind: "existing", ...candidates[0]! };
    throw severalApps(candidates);
  }
  const picked = await ctx.ui.select({
    message: "Which Superwall app is this for?",
    options: [...appOptions(candidates), { value: NEW_APP, label: "Create a new iOS app" }],
  });
  if (picked === null) throw new Error("Cancelled.");
  if (picked === NEW_APP) return { kind: "create", project: createIn };
  return { kind: "existing", ...candidates.find(({ app }) => String(app.id) === picked)! };
}

async function chooseAppleApp(
  ctx: CommandContext,
  session: AppleSession,
  bundleId: string | undefined,
): Promise<AppleApp & { bundleId: string }> {
  const hasBundle = (app: AppleApp): app is AppleApp & { bundleId: string } =>
    app.bundleId !== undefined;
  const team = session.team().name;
  if (bundleId) {
    const found = await apiCall(ctx, "Finding the App Store Connect app", () =>
      findApp(session, bundleId),
    );
    if (found && hasBundle(found)) return found;
    const others = (await listApps(session)).filter(hasBundle).map((app) => app.bundleId);
    const shown = others.slice(0, LISTED_APPS).join(", ");
    const more = others.length > LISTED_APPS ? `, and ${others.length - LISTED_APPS} more` : "";
    throw new Error(
      `No App Store Connect app with bundle ID ${bundleId} on the Apple team "${team}". Nothing was created.` +
        (others.length > 0 ? `\nThis team's apps: ${shown}${more}.` : "\nThis team has no apps yet.") +
        "\nCheck the bundle ID, sign in with an Apple Account on the right team, or create the app in App Store Connect.",
    );
  }
  const apps = (
    await apiCall(ctx, "Loading App Store Connect apps", () => listApps(session))
  ).filter(hasBundle);
  if (apps.length === 0) {
    throw new Error(
      `The Apple team "${team}" has no apps in App Store Connect yet. Create the app there, then run this again.`,
    );
  }
  if (!ctx.interactive) {
    throw new Error(
      `Pass --bundle-id <id>. This team's apps: ${apps.map((app) => app.bundleId).join(", ")}.`,
    );
  }
  const picked = await ctx.ui.select({
    message: "Which App Store Connect app?",
    options: apps.map((app) => ({
      value: app.id,
      label: app.name ?? app.bundleId,
      hint: app.bundleId,
    })),
  });
  if (picked === null) throw new Error("Cancelled.");
  return apps.find((app) => app.id === picked)!;
}

async function projectForNewApp(
  ctx: CommandContext,
  api: SuperwallApi,
  intent: Extract<AppIntent, { kind: "create" }>,
  name: string,
): Promise<string> {
  if (intent.project) return String(intent.project.id);
  const projects = await listProjects(api);
  if (projects.length === 0) {
    const created = await apiCall(ctx, "Creating a project", () => createProject(api, name));
    return String(created.id);
  }
  if (!ctx.interactive) {
    throw new Error(
      `Several projects found: ${projects.map((project) => `${project.id} (${project.name ?? "unnamed"})`).join(", ")}. Pass --project <id>.`,
    );
  }
  const picked = await ctx.ui.select({
    message: "Which project should the new app go in?",
    options: projects.map((project) => ({
      value: String(project.id),
      label: project.name ?? String(project.id),
    })),
  });
  if (picked === null) throw new Error("Cancelled.");
  return picked;
}

export async function resolveApp(
  ctx: CommandContext,
  api: SuperwallApi,
  session: AppleSession,
  intent: AppIntent,
  flags: AppFlags,
): Promise<ResolvedApp> {
  if (intent.kind === "existing") {
    const { app, project } = intent;
    if (flags.bundleId && app.bundle_id && flags.bundleId !== app.bundle_id) {
      ctx.output.render(
        blocks.warning(
          `Superwall has bundle ID ${app.bundle_id} for ${app.name ?? "this app"}; using ${flags.bundleId} from --bundle-id for Apple.`,
        ),
      );
    }
    const chosen = await chooseAppleApp(ctx, session, flags.bundleId ?? app.bundle_id);
    return {
      projectId: String(project.id),
      applicationId: String(app.id),
      name: app.name ?? String(app.id),
      bundleId: chosen.bundleId,
      ascAppId: chosen.id,
      created: false,
    };
  }

  const chosen = await chooseAppleApp(ctx, session, flags.bundleId);
  const name = chosen.name ?? chosen.bundleId;
  const projectId = await projectForNewApp(ctx, api, intent, name);
  const parent = (await apiCall(ctx, `Creating ${name} in Superwall`, () =>
    createApplication(api, { projectId }, { name, platform: "ios", bundleId: chosen.bundleId }),
  )) as Project;
  const created = (parent.applications ?? [])
    .filter(isIos)
    .find((app) => app.bundle_id === chosen.bundleId);
  if (!created) {
    throw new Error(
      `Superwall created ${name} but didn't return it. Nothing was created at Apple. Run this again with --app <id> (\`superwall apps\` lists ids).`,
    );
  }
  return {
    projectId,
    applicationId: String(created.id),
    name,
    bundleId: chosen.bundleId,
    ascAppId: chosen.id,
    created: true,
  };
}
