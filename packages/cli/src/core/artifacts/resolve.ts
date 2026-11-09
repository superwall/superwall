import * as path from "node:path";
import type { CommandContext } from "@/program/command";
import type { SuperwallApi } from "@/core/api/client";
import { DASHBOARD_ORIGIN_OVERRIDE } from "@/environment";
import { listOrganizations, orgProjects } from "@/core/api/orgs";
import { getMe, getArtifact, listInstallations, listVersions, listArtifacts, type Artifact, type ArtifactVersion } from "./api";
import { readBinding } from "./binding";
import { ArtifactError, type Entrypoint, type Manifest } from "./project";

export interface ArtifactRef {
  dir?: string;
  artifact?: string;
  org?: string;
}

export const projectRoot = (dir: string | undefined): string => path.resolve(dir ?? process.cwd());

export async function resolveArtifact(ctx: CommandContext<"required">, ref: ArtifactRef): Promise<Artifact> {
  if (ref.artifact !== undefined) {
    if (/^\d+$/.test(ref.artifact)) return getArtifact(ctx.api, ref.artifact);
    if (ref.org === undefined) {
      throw new ArtifactError(`A slug needs its organization: add --org <id>, or pass the artifact's id.`);
    }
    const [found] = await listArtifacts(ctx.api, ref.org, ref.artifact);
    if (!found) throw new ArtifactError(`No artifact \`${ref.artifact}\` in organization ${ref.org}.`);
    return found;
  }
  const binding = readBinding(projectRoot(ref.dir));
  if (!binding) {
    throw new ArtifactError(
      "This project isn't linked to an artifact yet. Run `superwall artifacts push`, or say which with --artifact <id>.",
    );
  }
  return getArtifact(ctx.api, binding.artifactId);
}

export function dashboardOrigin(apiHost: string): string {
  return (
    DASHBOARD_ORIGIN_OVERRIDE() ??
    (new URL(apiHost).hostname.endsWith(".dev") ? "https://app.superwall.dev" : "https://app.superwall.com")
  );
}

export const artifactUrl = (apiHost: string, artifact: Pick<Artifact, "organization_id" | "slug">): string =>
  `${dashboardOrigin(apiHost)}/${artifact.organization_id}/artifacts/${encodeURIComponent(artifact.slug)}`;

const EMBED_SLOTS: ReadonlySet<string> = new Set([
  "app.dashboard.widget@1",
  "campaign.tab@1",
  "campaign.metric@1",
  "user.panel@1",
  "user.action@1",
]);

type Linked = Pick<Artifact, "id" | "organization_id" | "slug">;

export const appEntrypointUrl = (apiHost: string, artifact: Linked, applicationId: string, entrypoint: Entrypoint): string => {
  const app = `${dashboardOrigin(apiHost)}/${artifact.organization_id}/${applicationId}`;
  if (entrypoint.slot === "chart.source@1") return `${app}/charts?cS=artifacts`;
  if (EMBED_SLOTS.has(entrypoint.slot)) return `${app}/embeds`;
  return `${app}/apps/${artifact.id}/${encodeURIComponent(entrypoint.id)}`;
};

async function orgApps(api: SuperwallApi, organizationId: number | string) {
  return (await orgProjects(api, String(organizationId))).flatMap((project) => project.applications ?? []);
}

export interface OpenLink {
  url: string;
  app?: string;
  otherApps?: boolean;
}

const mainEntrypoint = (entrypoints: readonly Entrypoint[]): Entrypoint | undefined =>
  entrypoints.find((entrypoint) => entrypoint.slot === "app.page@1") ??
  entrypoints.find((entrypoint) => EMBED_SLOTS.has(entrypoint.slot)) ??
  entrypoints.find((entrypoint) => entrypoint.slot === "chart.source@1");

export async function openLink(
  ctx: CommandContext<"required">,
  artifact: Linked,
  manifest: Pick<Manifest, "entrypoints"> | null | undefined,
): Promise<OpenLink> {
  const fallback = { url: artifactUrl(ctx.api.host, artifact) };
  const entrypoints = manifest?.entrypoints ?? [];
  const main = mainEntrypoint(entrypoints);
  if (!main || entrypoints.some((entrypoint) => entrypoint.slot === "org.page@1")) return fallback;
  const apps = await orgApps(ctx.api, artifact.organization_id).catch(() => []);
  const [first] = apps;
  if (first === undefined) return fallback;
  return {
    url: appEntrypointUrl(ctx.api.host, artifact, String(first.id), main),
    app: String(first.name ?? first.id),
    otherApps: apps.length > 1,
  };
}

export async function awaitingInstall(
  api: SuperwallApi,
  artifactId: string | number,
  manifest: Pick<Manifest, "entrypoints"> | null | undefined,
): Promise<boolean> {
  const entrypoints = manifest?.entrypoints ?? [];
  if (entrypoints.length === 0 || entrypoints.some((entrypoint) => entrypoint.slot === "org.page@1")) return false;
  const installed = await listInstallations(api, artifactId).catch(() => undefined);
  if (installed === undefined) return false;
  return entrypoints.every((entrypoint) => !installed.some((row) => row.entrypoint_id === entrypoint.id));
}

// Where an installed entrypoint shows, by slot. An org.page shows on its own, so it's never here.
const INSTALL_SURFACE: Readonly<Record<string, string>> = {
  "chart.source@1": "Charts",
  "campaign.metric@1": "Campaigns",
  "campaign.tab@1": "Campaigns",
  "app.dashboard.widget@1": "The app dashboard",
  "user.panel@1": "User pages",
  "user.action@1": "User pages",
};

export interface InstallHint {
  entrypoint_id: string;
  slot: string;
  command: string;
  sentence: string;
}

/**
 * One line per entrypoint that has no installation yet, saying what won't show it and the command that
 * installs it. Empty when the installations can't be read, so a failed read never claims anything.
 */
export async function installHints(
  api: SuperwallApi,
  artifact: Pick<Artifact, "id" | "organization_id">,
  manifest: Pick<Manifest, "entrypoints"> | null | undefined,
  { artifactFlag = false }: { artifactFlag?: boolean } = {},
): Promise<InstallHint[]> {
  const installable = (manifest?.entrypoints ?? []).filter((entrypoint) => entrypoint.slot !== "org.page@1");
  if (installable.length === 0) return [];
  const installed = await listInstallations(api, artifact.id).catch(() => undefined);
  if (installed === undefined) return [];
  const missing = installable.filter((entrypoint) => !installed.some((row) => row.entrypoint_id === entrypoint.id));
  if (missing.length === 0) return [];
  const apps = await orgApps(api, artifact.organization_id).catch(() => []);
  const app = apps.length === 1 ? String(apps[0]!.id) : "<app-id>";
  return missing.map((entrypoint) => {
    const command = [
      `superwall artifacts install ${entrypoint.id}`,
      `--app ${app}`,
      ...(artifactFlag ? [`--artifact ${artifact.id}`] : []),
    ].join(" ");
    const title = JSON.stringify(entrypoint.title || entrypoint.id);
    const surface = INSTALL_SURFACE[entrypoint.slot];
    const sentence = surface
      ? `${surface} won't show ${title} until you install it: ${command}`
      : `${title} won't show until you install it: ${command}`;
    return { entrypoint_id: entrypoint.id, slot: entrypoint.slot, command, sentence };
  });
}

export const notInstalledOf = ({ entrypoint_id, slot, command }: InstallHint) => ({ entrypoint_id, slot, command });

export const latestManifest = (versions: readonly ArtifactVersion[]): Manifest | null | undefined =>
  newestFirst(versions).find((version) => version.manifest !== null)?.manifest;

export type VisibleTo = "everyone" | "you" | "its_author" | "nobody";

export async function visibilityOf(
  ctx: CommandContext<"required">,
  artifactId: string | number,
  version: number,
  manifest: Pick<Manifest, "entrypoints"> | null | undefined,
): Promise<{ visibleTo: VisibleTo; sentence: string }> {
  const [artifact, me] = await Promise.all([
    getArtifact(ctx.api, artifactId).catch(() => undefined),
    getMe(ctx.api).catch(() => undefined),
  ]);
  if (artifact?.state === "turned_off") {
    return { visibleTo: "nobody", sentence: `This artifact is turned off, so nobody can see version ${version}.` };
  }
  if (artifact?.active_version_id === version) {
    if (await awaitingInstall(ctx.api, artifactId, manifest)) {
      return {
        visibleTo: "its_author",
        sentence: `Version ${version} is approved, but nothing is installed yet, so only its author can see it, marked "Not installed". An admin chooses where it shows with \`superwall artifacts install\`.`,
      };
    }
    return { visibleTo: "everyone", sentence: `Version ${version} is live.` };
  }
  if (artifact?.author_version_id === version) {
    return { visibleTo: "you", sentence: `Only you can see version ${version} until an admin approves it.` };
  }
  if (me?.role === "SUPERADMIN") {
    return {
      visibleTo: "nobody",
      sentence: `Nobody can see version ${version} until an admin approves it, because a staff account doesn't get a copy of its own.`,
    };
  }
  return { visibleTo: "its_author", sentence: `Only its author can see version ${version} until an admin approves it.` };
}

export async function roleCanApprove(ctx: CommandContext<"required">, artifact: Pick<Artifact, "organization_id">): Promise<boolean> {
  const organizations = await listOrganizations(ctx.api).catch(() => []);
  const role = organizations.find((organization) => String(organization.id) === String(artifact.organization_id))?.role;
  return typeof role !== "string" || role === "OWNER" || role === "ADMIN";
}

export const newestFirst = (versions: readonly ArtifactVersion[]): ArtifactVersion[] =>
  [...versions].sort((a, b) => b.id - a.id);

export async function pickVersion(
  ctx: CommandContext<"required">,
  artifact: Artifact,
  requested: string | undefined,
  matches: (version: ArtifactVersion) => boolean = () => true,
): Promise<{ version: ArtifactVersion; versions: ArtifactVersion[] }> {
  const versions = newestFirst(await listVersions(ctx.api, artifact.id));
  if (requested !== undefined) {
    const version = versions.find((candidate) => String(candidate.id) === requested);
    if (!version) throw new ArtifactError(`No version ${requested} of \`${artifact.slug}\`.`);
    return { version, versions };
  }
  const version = versions.find(matches);
  if (!version) throw new ArtifactError(`\`${artifact.slug}\` has no version for this yet. Run \`superwall artifacts push\`.`);
  return { version, versions };
}
