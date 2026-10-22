import { UsageError } from "@/program/command";
import { attribute, compact, linkTo, numberAttribute, relatedId, selectIncluded, type AscDocument, type AscResource } from "./json-api";
import { argOf, requireText, textOf, type AscFlag, type AscInput, type AscOutput } from "./operation";
import { assertConfirmed, isPlaceholder, type AscSession } from "./session";
import { resolveAscAppId } from "./targets";

export const PLATFORMS = ["IOS", "MAC_OS", "TV_OS", "VISION_OS"] as const;
export const RELEASE_TYPES = ["MANUAL", "AFTER_APPROVAL", "SCHEDULED"] as const;
export const APP_VERSION_STATES = [
  "ACCEPTED",
  "DEVELOPER_REJECTED",
  "IN_REVIEW",
  "INVALID_BINARY",
  "METADATA_REJECTED",
  "PENDING_APPLE_RELEASE",
  "PENDING_DEVELOPER_RELEASE",
  "PREPARE_FOR_SUBMISSION",
  "PROCESSING_FOR_DISTRIBUTION",
  "READY_FOR_DISTRIBUTION",
  "READY_FOR_REVIEW",
  "REJECTED",
  "REPLACED_WITH_NEW_VERSION",
  "WAITING_FOR_EXPORT_COMPLIANCE",
  "WAITING_FOR_REVIEW",
] as const;
const EDITABLE = new Set(["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY"]);
const DEFAULT_PLATFORM = "IOS";
const VERSION_FIELDS = "platform,versionString,appVersionState,releaseType,earliestReleaseDate,copyright,createdDate";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const VERSION_ARG = { name: "version", describe: "The App Store version: its id, or its version string with --asc-app", required: true } as const;

export const VERSION_FLAGS = {
  ascApp: { type: "string", value: "id|bundle id", describe: "The App Store app, to find <version> by its version string" },
  platform: { type: "string", value: "platform", describe: "The platform of <version>, with a version string (default IOS)", choices: PLATFORMS },
} as const satisfies Record<string, AscFlag>;

export interface VersionRow {
  id: string;
  versionString?: string;
  platform?: string;
  appVersionState?: string;
  releaseType?: string;
  earliestReleaseDate?: string;
  copyright?: string;
  createdDate?: string;
}

interface BuildSummary {
  id: string;
  version?: string;
  processingState?: string;
  uploadedDate?: string;
}

interface PhasedReleaseView {
  id: string;
  phasedReleaseState?: string;
  startDate?: string;
  currentDayNumber?: number;
  totalPauseDuration?: number;
}

export function rowOfVersion(resource: AscResource): VersionRow {
  return {
    id: resource.id,
    ...compact({
      versionString: attribute(resource, "versionString"),
      platform: attribute(resource, "platform"),
      appVersionState: attribute(resource, "appVersionState"),
      releaseType: attribute(resource, "releaseType"),
      earliestReleaseDate: attribute(resource, "earliestReleaseDate"),
      copyright: attribute(resource, "copyright"),
      createdDate: attribute(resource, "createdDate"),
    }),
  };
}

function summaryOfBuild(resource: AscResource): BuildSummary {
  return {
    id: resource.id,
    ...compact({
      version: attribute(resource, "version"),
      processingState: attribute(resource, "processingState"),
      uploadedDate: attribute(resource, "uploadedDate"),
    }),
  };
}

export function viewOfPhasedRelease(resource: AscResource): PhasedReleaseView {
  return {
    id: resource.id,
    ...compact({
      phasedReleaseState: attribute(resource, "phasedReleaseState"),
      startDate: attribute(resource, "startDate"),
      currentDayNumber: numberAttribute(resource, "currentDayNumber"),
      totalPauseDuration: numberAttribute(resource, "totalPauseDuration"),
    }),
  };
}

const versionRows = (rows: readonly VersionRow[]) =>
  rows.map((row) => ({
    label: row.versionString ?? row.id,
    meta: [row.platform, row.appVersionState, row.releaseType, row.id].filter(Boolean).join("  "),
  }));

export async function resolveVersionId(session: AscSession, input: AscInput): Promise<string> {
  const value = argOf(input, "version");
  if (UUID.test(value) || isPlaceholder(value)) return value;
  const ascApp = textOf(input, "ascApp");
  if (!ascApp) throw new UsageError(`To find version "${value}" by its version string, pass --asc-app <id|bundle id>, or pass the version's id.`);
  const app = await resolveAscAppId(session, ascApp);
  const platform = textOf(input, "platform") ?? DEFAULT_PLATFORM;
  const document = await session.next(
    `/v1/apps/${app}/appStoreVersions?filter[versionString]=${encodeURIComponent(value)}&filter[platform]=${platform}&fields[appStoreVersions]=versionString&limit=1`,
  );
  const id = document.data[0]?.id;
  if (!id) throw new Error(`App ${app} has no ${platform} version ${value}.`);
  return id;
}

export async function findVersion(session: AscSession, id: string, include: readonly string[] = []): Promise<{ version: AscResource; document: AscDocument }> {
  const fields = [VERSION_FIELDS, ...include].join(",");
  const query = [`fields[appStoreVersions]=${fields}`, ...(include.length ? [`include=${include.join(",")}`] : [])];
  const document = await session.next(`/v1/appStoreVersions/${id}?${query.join("&")}`);
  const version = document.one;
  if (!version) throw new Error(`No App Store version ${id}.`);
  return { version, document };
}

export function buildOf(document: AscDocument, version: AscResource): BuildSummary | null {
  const build = selectIncluded(document, "builds", relatedId(version, "build"));
  return build ? summaryOfBuild(build) : null;
}

export function phasedReleaseOf(document: AscDocument, version: AscResource): PhasedReleaseView | null {
  const phased = selectIncluded(document, "appStoreVersionPhasedReleases", relatedId(version, "appStoreVersionPhasedRelease"));
  return phased ? viewOfPhasedRelease(phased) : null;
}

export async function runVersionsList(session: AscSession, input: AscInput): Promise<AscOutput> {
  const app = await resolveAscAppId(session, argOf(input, "asc-app"));
  const filters = compact({
    platform: textOf(input, "platform"),
    versionString: textOf(input, "versionString"),
    appVersionState: textOf(input, "appVersionState"),
  });
  const query = Object.entries(filters).map(([key, value]) => `filter[${key}]=${encodeURIComponent(String(value))}`);
  const document = await session.list(`/v1/apps/${app}/appStoreVersions?${[...query, `fields[appStoreVersions]=${VERSION_FIELDS}`, "limit=200"].join("&")}`);
  const rows = (document?.data ?? []).map(rowOfVersion);
  return { rows: versionRows(rows), data: rows, noun: "version" };
}

export async function runVersionsGet(session: AscSession, input: AscInput): Promise<AscOutput> {
  const id = await resolveVersionId(session, input);
  const { version, document } = await findVersion(session, id, ["build", "appStoreVersionLocalizations", "appStoreVersionPhasedRelease"]);
  const localizations = document.included
    .filter((resource) => resource.type === "appStoreVersionLocalizations")
    .map((resource) => ({ id: resource.id, ...compact({ locale: attribute(resource, "locale"), whatsNew: attribute(resource, "whatsNew") }) }));
  return {
    value: {
      ...rowOfVersion(version),
      build: buildOf(document, version),
      localizations,
      phasedRelease: phasedReleaseOf(document, version),
    },
  };
}

function versionAttributes(input: AscInput, creating: boolean): Record<string, unknown> {
  const attributes = compact({
    versionString: textOf(input, "versionString"),
    releaseType: textOf(input, "releaseType"),
    earliestReleaseDate: textOf(input, "earliestReleaseDate"),
    copyright: textOf(input, "copyright"),
  });
  const scheduled = attributes.releaseType === "SCHEDULED" || (!creating && attributes.releaseType === undefined);
  if (attributes.earliestReleaseDate !== undefined && !scheduled) {
    throw new UsageError("--earliest-release-date goes with --release-type SCHEDULED.");
  }
  return attributes;
}

export async function runVersionsCreate(session: AscSession, input: AscInput): Promise<AscOutput> {
  const attributes = versionAttributes(input, true);
  const app = await resolveAscAppId(session, requireText(input, "ascApp"));
  const platform = textOf(input, "platform") ?? DEFAULT_PLATFORM;
  const created = await session.send(
    "post",
    "/v1/appStoreVersions",
    { data: { type: "appStoreVersions", attributes: { platform, ...attributes }, relationships: { app: linkTo("apps", app) } } },
    "version",
  );
  if (!created) throw new Error("Apple created no App Store version.");
  const row = rowOfVersion(created);
  return { value: row, heading: `Created ${platform} version ${requireText(input, "versionString")} (${row.appVersionState ?? "state unknown"})` };
}

export async function runVersionsUpdate(session: AscSession, input: AscInput): Promise<AscOutput> {
  const attributes = versionAttributes(input, false);
  if (Object.keys(attributes).length === 0) {
    throw new UsageError("Nothing to change: pass --version-string, --release-type, --earliest-release-date or --copyright.");
  }
  const id = await resolveVersionId(session, input);
  await session.send("patch", `/v1/appStoreVersions/${id}`, { data: { type: "appStoreVersions", id, attributes } });
  return { value: { id, ...attributes }, heading: `Updated version ${id}` };
}

export async function runVersionsDelete(session: AscSession, input: AscInput): Promise<AscOutput> {
  const id = await resolveVersionId(session, input);
  const { version } = await findVersion(session, id);
  const row = rowOfVersion(version);
  const name = row.versionString ?? id;
  if (!EDITABLE.has(row.appVersionState ?? "")) {
    throw new Error(`Version ${name} is ${row.appVersionState ?? "in an unknown state"}; Apple only deletes a version while it's editable (${[...EDITABLE].join(", ")}).`);
  }
  await assertConfirmed(session, input.yes, `Delete version ${name}`);
  await session.send("delete", `/v1/appStoreVersions/${id}`);
  return { value: { id, deleted: true }, heading: `Deleted version ${name}` };
}
