import { UsageError } from "@/program/command";
import { attribute, compact, relatedId, selectIncluded, type AscDocument, type AscResource } from "./json-api";
import { argOf, numberOf, textOf, type AscInput, type AscOutput } from "./operation";
import { assertConfirmed, type AscSession } from "./session";
import { resolveAscAppId } from "./targets";
import { resolveVersionId, rowOfVersion } from "./versions";

export const PROCESSING_STATES = ["PROCESSING", "FAILED", "INVALID", "VALID"] as const;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;
const BUILD_FIELDS = "version,uploadedDate,expirationDate,expired,minOsVersion,processingState,usesNonExemptEncryption,preReleaseVersion";

interface BuildRow {
  id: string;
  version?: string;
  versionString?: string;
  platform?: string;
  processingState?: string;
  uploadedDate?: string;
  expirationDate?: string;
  expired?: boolean;
  minOsVersion?: string;
}

function rowOf(build: AscResource, document: AscDocument): BuildRow {
  const prerelease = selectIncluded(document, "preReleaseVersions", relatedId(build, "preReleaseVersion"));
  const expired = build.attributes.expired;
  return {
    id: build.id,
    ...compact({
      version: attribute(build, "version"),
      versionString: prerelease ? attribute(prerelease, "version") : undefined,
      platform: prerelease ? attribute(prerelease, "platform") : undefined,
      processingState: attribute(build, "processingState"),
      uploadedDate: attribute(build, "uploadedDate"),
      expirationDate: attribute(build, "expirationDate"),
      expired: typeof expired === "boolean" ? expired : undefined,
      minOsVersion: attribute(build, "minOsVersion"),
    }),
  };
}

const buildRows = (rows: readonly BuildRow[]) =>
  rows.map((row) => ({
    label: `${row.versionString ?? "?"} (${row.version ?? "?"})`,
    meta: [row.processingState, row.expired ? "expired" : undefined, row.uploadedDate, row.id].filter(Boolean).join("  "),
  }));

function resolveLimit(input: AscInput): number {
  const limit = numberOf(input, "limit") ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new UsageError(`--limit takes a whole number from 1 to ${MAX_LIMIT}.`);
  return limit;
}

export async function runBuildsList(session: AscSession, input: AscInput): Promise<AscOutput> {
  const limit = resolveLimit(input);
  const app = await resolveAscAppId(session, argOf(input, "asc-app"));
  const filters = compact({
    "preReleaseVersion.version": textOf(input, "versionString"),
    version: textOf(input, "version"),
    processingState: textOf(input, "processingState"),
    "preReleaseVersion.platform": textOf(input, "platform"),
  });
  const query = [
    `filter[app]=${app}`,
    ...Object.entries(filters).map(([key, value]) => `filter[${key}]=${encodeURIComponent(String(value))}`),
    "sort=-uploadedDate",
    "include=preReleaseVersion",
    `fields[builds]=${BUILD_FIELDS}`,
    "fields[preReleaseVersions]=version,platform",
    `limit=${limit}`,
  ];
  const document = await session.next(`/v1/builds?${query.join("&")}`);
  const rows = document.data.map((build) => rowOf(build, document));
  return { rows: buildRows(rows), data: rows, noun: "build" };
}

export async function runBuildsGet(session: AscSession, input: AscInput): Promise<AscOutput> {
  const id = argOf(input, "id");
  const document = await session.next(
    `/v1/builds/${id}?include=preReleaseVersion,appStoreVersion&fields[builds]=${BUILD_FIELDS},appStoreVersion&fields[preReleaseVersions]=version,platform&fields[appStoreVersions]=platform,versionString,appVersionState`,
  );
  const build = document.one;
  if (!build) throw new Error(`No build ${id}.`);
  const version = selectIncluded(document, "appStoreVersions", relatedId(build, "appStoreVersion"));
  const encryption = build.attributes.usesNonExemptEncryption;
  return {
    value: {
      ...rowOf(build, document),
      ...(typeof encryption === "boolean" ? { usesNonExemptEncryption: encryption } : {}),
      appStoreVersion: version ? rowOfVersion(version) : null,
    },
  };
}

export async function runBuildsAttach(session: AscSession, input: AscInput): Promise<AscOutput> {
  const build = argOf(input, "id");
  const version = await resolveVersionId(session, input);
  await session.send("patch", `/v1/appStoreVersions/${version}/relationships/build`, { data: { type: "builds", id: build } });
  return { value: { appStoreVersion: version, build }, heading: `Attached build ${build} to version ${version}` };
}

export async function runBuildsExpire(session: AscSession, input: AscInput): Promise<AscOutput> {
  const id = argOf(input, "id");
  await assertConfirmed(session, input.yes, `Expire build ${id}: testers can no longer install it, and no version can use it`);
  await session.send("patch", `/v1/builds/${id}`, { data: { type: "builds", id, attributes: { expired: true } } });
  return { value: { id, expired: true }, heading: `Expired build ${id}` };
}
