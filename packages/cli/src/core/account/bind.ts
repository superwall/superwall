import { Integration } from "@/environment";
import { ui, type Opt } from "@/ui";
import { requireOrg } from "@/core/account/org";
import type { SuperwallApi } from "@/core/api/client";
import {
  createApplication,
  createProject,
  listProjects,
  platformLabel,
  type Application,
  type Project,
} from "@/core/api/resources";

const NEW = "__new__";
const NEW_PROJECT = "__new_project__";

const BACK = "esc back";
const CANCEL = "esc cancel";

export interface AppBinding {
  apiKey: string;
  app: Application;
  projectId: string;
  applicationId: string;
}

export function platformForIntegration(integration: Integration): string {
  switch (integration) {
    case Integration.swift:
      return "ios";
    case Integration.flutter:
      return "flutter";
    case Integration.expo:
    case Integration.reactNative:
      return "react_native";
    case Integration.web:
      return "web";
    default:
      return "ios";
  }
}

export async function resolveAppBinding(
  api: SuperwallApi,
  opts: { platform: string; appName: string; bundleId?: string },
): Promise<AppBinding | null> {
  const projects = await loading("Loading your projects", () => listProjects(api));
  let lastProjectId: string | undefined;

  for (;;) {
    const project = await pickProject(api, projects, opts.appName, lastProjectId);
    if (project === "cancel") return null;
    lastProjectId = String(project.id); // so going back re-selects it

    const app = await pickApp(api, project, opts);
    if (app === "back") continue;

    if (!app.public_api_key) {
      ui.warn(`\`${app.name ?? app.id}\` has no SDK key yet - pick another or add a new app.`);
      return null;
    }
    return {
      apiKey: app.public_api_key,
      app,
      projectId: String(project.id),
      applicationId: String(app.id),
    };
  }
}

// Lets an already-integrated app (pk_ key already in code) reach later stages without re-picking.
export async function resolveScopeFromKey(
  api: SuperwallApi,
  publicApiKey: string,
): Promise<{
  projectId: string;
  applicationId: string;
  appName?: string;
  bundleId?: string;
} | null> {
  if (!publicApiKey) return null;
  const projects = await listProjects(api);
  for (const project of projects) {
    const app = (project.applications ?? []).find((a) => a.public_api_key === publicApiKey);
    if (app) {
      return {
        projectId: String(project.id),
        applicationId: String(app.id),
        appName: app.name,
        bundleId: app.bundle_id,
      };
    }
  }
  return null;
}

async function pickProject(
  api: SuperwallApi,
  projects: Project[],
  defaultName: string,
  preselect?: string,
): Promise<Project | "cancel"> {
  for (;;) {
    if (projects.length === 0) {
      const created = await createProjectFlow(api, defaultName);
      return created === "back" ? "cancel" : created; // nothing behind the root → cancel
    }

    const sel = await ui.select({
      message: "Which Superwall project?",
      options: [
        ...projects.map((p) => ({
          value: String(p.id),
          label: p.name ?? String(p.id),
          hint: appCountHint(p),
        })),
        { value: NEW, label: "＋ Create a new project" },
      ],
      initialValue: preselect ?? String(projects[0]!.id),
      footer: CANCEL,
      transient: true,
    });
    if (sel === null) return "cancel";
    if (sel === NEW) {
      const created = await createProjectFlow(api, defaultName);
      if (created === "back") continue;
      return created;
    }
    return projects.find((p) => String(p.id) === sel)!;
  }
}

async function pickApp(
  api: SuperwallApi,
  project: Project,
  opts: { platform: string; appName: string; bundleId?: string },
): Promise<Application | "back"> {
  for (;;) {
    const apps = project.applications ?? [];
    const label = platformLabel(opts.platform);
    if (apps.length === 0) {
      const sel = await ui.select({
        message: `No apps in \`${project.name ?? "this project"}\` yet.`,
        options: [
          {
            value: NEW,
            label: `＋ Create a new ${label} app`,
            hint: opts.appName,
          },
        ],
        initialValue: NEW,
        footer: BACK,
        transient: true,
      });
      if (sel === null) return "back";
      const created = await createAppFlow(api, project, opts);
      if (created === "back") continue;
      return created;
    }

    // One app per platform per project; other-platform apps are shown but disabled.
    const platformTaken = apps.some((a) => a.platform === opts.platform);
    const match = apps.find((a) => a.platform === opts.platform) ?? apps[0]!;

    const options: Opt[] = apps.map((a) => ({
      value: String(a.id),
      label: a.name ?? String(a.id),
      hint: [platformLabel(a.platform), a.bundle_id].filter(Boolean).join(" · "),
      disabled: a.platform !== opts.platform,
    }));
    options.push(
      platformTaken
        ? {
            value: NEW_PROJECT,
            label: `＋ New project with its own ${label} app`,
          }
        : { value: NEW, label: `＋ Add a new ${label} app` },
    );

    const sel = await ui.select({
      message: `Which app in \`${project.name ?? "this project"}\`?`,
      options,
      initialValue: String(match.id),
      footer: BACK,
      transient: true,
    });
    if (sel === null) return "back";
    if (sel === NEW) {
      const created = await createAppFlow(api, project, opts);
      if (created === "back") continue;
      return created;
    }
    if (sel === NEW_PROJECT) {
      const fresh = await createProjectFlow(api, opts.appName);
      if (fresh === "back") continue;
      const created = await createAppFlow(api, fresh, opts);
      if (created === "back") continue;
      return created;
    }
    return apps.find((a) => String(a.id) === sel)!;
  }
}

async function createProjectFlow(
  api: SuperwallApi,
  defaultName: string,
): Promise<Project | "back"> {
  await requireOrg(api, true);
  const name = await ui.text({
    message: "Name your new project",
    placeholder: defaultName,
    validate: (v) => (v?.trim() ? undefined : "Required"),
    footer: BACK,
    transient: true,
  });
  if (name === null) return "back";
  const created = (await loading("Creating project", () =>
    createProject(api, name.trim()),
  )) as Project;
  ui.success(`Created project \`${created.name ?? name.trim()}\``);
  return {
    id: created.id,
    name: created.name ?? name.trim(),
    applications: [],
  };
}

async function createAppFlow(
  api: SuperwallApi,
  project: Project,
  opts: { platform: string; appName: string; bundleId?: string },
): Promise<Application | "back"> {
  const label = platformLabel(opts.platform);
  for (;;) {
    const name = await ui.text({
      message: `Name the ${label} app`,
      placeholder: opts.appName,
      initialValue: opts.appName,
      validate: (v) => (v?.trim() ? undefined : "Required"),
      footer: BACK,
      transient: true,
    });
    if (name === null) return "back";

    const bundle = await ui.text({
      message: "Bundle id / package name (optional)",
      placeholder: opts.bundleId ?? "com.company.app",
      footer: "enter to skip · esc back",
      transient: true,
    });
    if (bundle === null) continue;
    const bundleId = bundle.trim() || opts.bundleId;

    // createApplication returns the parent project with the new app nested inside.
    const parent = (await loading(`Adding the ${label} app`, () =>
      createApplication(
        api,
        { projectId: String(project.id) },
        { name: name.trim(), platform: opts.platform, bundleId },
      ),
    )) as Project;
    const created =
      parent.applications?.find((a) => a.name === name.trim() && a.platform === opts.platform) ??
      parent.applications?.find((a) => a.platform === opts.platform) ??
      parent.applications?.at(-1);
    if (!created) {
      ui.warn("The app was created but its key didn't come back - try again.");
      continue;
    }
    ui.success(`Added ${label} app \`${created.name ?? name.trim()}\``);
    return created;
  }
}

function appCountHint(p: Project): string {
  const n = (p.applications ?? []).length;
  return `${n} app${n === 1 ? "" : "s"}`;
}

async function loading<T>(label: string, work: () => Promise<T>): Promise<T> {
  const spin = ui.spinner();
  spin.start(label);
  try {
    const result = await work();
    spin.stop(label);
    return result;
  } catch (e) {
    spin.stop("Failed");
    throw e;
  }
}
