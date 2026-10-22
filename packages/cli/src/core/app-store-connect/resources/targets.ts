import { UsageError } from "@/program/command";
import { attribute, linkTo, numberAttribute, type AscResource } from "./json-api";
import { textOf, type AscFlag, type AscInput } from "./operation";
import { isPlaceholder, placeholder, type AscSession } from "./session";

export type ProductKind = "subscription" | "group" | "iap";

interface KindSpec {
  flag: string;
  noun: string;
  versions: (id: string) => string;
  versionPath: string;
  versionType: string;
  owner: string;
  ownerType: string;
  localizations: (version: string) => string;
  localizationPath: string;
  localizationType: string;
  localizedFields: readonly string[];
  submitItem: string;
}

export const KINDS: Record<ProductKind, KindSpec> = {
  subscription: {
    flag: "--subscription",
    noun: "subscription",
    versions: (id) => `/v1/subscriptions/${id}/versions`,
    versionPath: "/v1/subscriptionVersions",
    versionType: "subscriptionVersions",
    owner: "subscription",
    ownerType: "subscriptions",
    localizations: (version) => `/v1/subscriptionVersions/${version}/localizations?limit=200`,
    localizationPath: "/v2/subscriptionLocalizations",
    localizationType: "subscriptionLocalizations",
    localizedFields: ["name", "description"],
    submitItem: "subscriptionVersion",
  },
  group: {
    flag: "--group",
    noun: "subscription group",
    versions: (id) => `/v1/subscriptionGroups/${id}/versions`,
    versionPath: "/v1/subscriptionGroupVersions",
    versionType: "subscriptionGroupVersions",
    owner: "subscriptionGroup",
    ownerType: "subscriptionGroups",
    localizations: (version) => `/v1/subscriptionGroupVersions/${version}/localizations?limit=200`,
    localizationPath: "/v2/subscriptionGroupLocalizations",
    localizationType: "subscriptionGroupLocalizations",
    localizedFields: ["name", "customAppName"],
    submitItem: "subscriptionGroupVersion",
  },
  iap: {
    flag: "--iap",
    noun: "in-app purchase",
    versions: (id) => `/v2/inAppPurchases/${id}/versions`,
    versionPath: "/v1/inAppPurchaseVersions",
    versionType: "inAppPurchaseVersions",
    owner: "inAppPurchase",
    ownerType: "inAppPurchases",
    localizations: (version) => `/v1/inAppPurchaseVersions/${version}/localizations?limit=200`,
    localizationPath: "/v2/inAppPurchaseLocalizations",
    localizationType: "inAppPurchaseLocalizations",
    localizedFields: ["name", "description"],
    submitItem: "inAppPurchaseVersion",
  },
};

export const TARGET_FLAGS = {
  subscription: { type: "string", value: "id", describe: "The subscription's id" },
  group: { type: "string", value: "id", describe: "The subscription group's id" },
  iap: { type: "string", value: "id", describe: "The in-app purchase's id" },
} as const satisfies Record<ProductKind, AscFlag>;

export interface Target<K extends ProductKind = ProductKind> {
  kind: K;
  id: string;
}

export function resolveTarget<K extends ProductKind>(input: AscInput, kinds: readonly K[]): Target<K> {
  const given = kinds.flatMap((kind) => {
    const id = textOf(input, kind);
    return id === undefined ? [] : [{ kind, id }];
  });
  const [only] = given;
  if (!only || given.length > 1) {
    const flags = kinds.map((kind) => KINDS[kind].flag);
    throw new UsageError(`Pass one of ${flags.slice(0, -1).join(", ")}${flags.length > 2 ? "," : ""} or ${flags.at(-1)}.`);
  }
  return only;
}

export async function resolveAscAppId(session: AscSession, value: string): Promise<string> {
  if (/^\d+$/.test(value)) return value;
  const document = await session.get(`/v1/apps?filter[bundleId]=${encodeURIComponent(value)}&fields[apps]=bundleId&limit=10`);
  const id = document?.data[0]?.id;
  if (!id) throw new Error(`No App Store Connect app found for "${value}".`);
  return id;
}

export async function resolveGroupId(session: AscSession, value: string, ascApp: string | undefined): Promise<string> {
  if (/^\d+$/.test(value)) return value;
  if (!ascApp) throw new UsageError(`To find the group "${value}" by name, pass --asc-app <id|bundle id>, or pass the group's id.`);
  const app = await resolveAscAppId(session, ascApp);
  const document = await session.list(`/v1/apps/${app}/subscriptionGroups?limit=200`);
  const group = document?.data.find((candidate) => attribute(candidate, "referenceName") === value);
  if (!group) throw new Error(`No subscription group named "${value}" in app ${app}.`);
  return group.id;
}

export interface VersionView {
  id: string;
  version?: number;
  state?: string;
}

const EDITABLE = new Set(["PREPARE_FOR_SUBMISSION", "READY_FOR_REVIEW", "REJECTED", "DEVELOPER_REJECTED"]);

function viewOfVersion(resource: AscResource): VersionView {
  return { id: resource.id, version: numberAttribute(resource, "version"), state: attribute(resource, "state") };
}

export async function selectLatestVersion(session: AscSession, kind: ProductKind, id: string): Promise<VersionView | undefined> {
  if (isPlaceholder(id)) {
    await session.get(KINDS[kind].versions(id));
    return { id: placeholder("version") };
  }
  const document = await session.list(KINDS[kind].versions(id));
  const versions = (document?.data ?? []).map(viewOfVersion);
  return versions.sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0];
}

export async function resolveDraftVersion(session: AscSession, kind: ProductKind, id: string): Promise<string> {
  const latest = await selectLatestVersion(session, kind, id);
  if (latest && (isPlaceholder(latest.id) || EDITABLE.has(latest.state ?? ""))) return latest.id;
  const spec = KINDS[kind];
  const created = await session.send(
    "post",
    spec.versionPath,
    { data: { type: spec.versionType, relationships: { [spec.owner]: linkTo(spec.ownerType, id) } } },
    "version",
  );
  if (!created) throw new Error(`Apple created no new version of ${spec.noun} ${id}.`);
  return created.id;
}

export async function resolveTerritories(session: AscSession, value: string): Promise<string[]> {
  if (value.toLowerCase() !== "all") {
    return value.split(",").map((territory) => territory.trim().toUpperCase()).filter(Boolean);
  }
  const document = await session.list("/v1/territories?limit=200&fields[territories]=currency");
  return (document?.data ?? []).map((territory) => territory.id);
}
