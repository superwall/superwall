import { UsageError } from "@/program/command";
import { attribute, compact, linkTo, type AscResource } from "./json-api";
import { requireText, textOf, type AscFlag, type AscInput, type AscOutput } from "./operation";
import type { AscSession } from "./session";
import { resolveVersionId } from "./versions";

export const METADATA_FIELDS = {
  whatsNew: { type: "string", value: "text", describe: "What's New in this version" },
  description: { type: "string", value: "text", describe: "The App Store description" },
  keywords: { type: "string", value: "a,b,c", describe: "Search keywords, comma-separated" },
  promotionalText: { type: "string", value: "text", describe: "Promotional text, changeable without a new version" },
  supportUrl: { type: "string", value: "url", describe: "The support URL" },
  marketingUrl: { type: "string", value: "url", describe: "The marketing URL" },
} as const satisfies Record<string, AscFlag>;

const KEYS = Object.keys(METADATA_FIELDS);

interface MetadataView {
  id: string;
  locale?: string;
  whatsNew?: string;
  description?: string;
  keywords?: string;
  promotionalText?: string;
  supportUrl?: string;
  marketingUrl?: string;
}

function viewOf(resource: AscResource): MetadataView {
  return { id: resource.id, ...compact(Object.fromEntries(["locale", ...KEYS].map((key) => [key, attribute(resource, key)]))) };
}

function changesOf(input: AscInput): Record<string, unknown> {
  return compact(Object.fromEntries(KEYS.map((key) => [key, textOf(input, key)])));
}

async function findLocalization(session: AscSession, version: string, locale: string): Promise<AscResource> {
  const document = await session.next(`/v1/appStoreVersions/${version}/appStoreVersionLocalizations?filter[locale]=${encodeURIComponent(locale)}&limit=1`);
  const found = document.data[0];
  if (!found) throw new Error(`Version ${version} has no ${locale} metadata. Add it with asc metadata add.`);
  return found;
}

export async function runMetadataList(session: AscSession, input: AscInput): Promise<AscOutput> {
  const version = await resolveVersionId(session, input);
  const document = await session.list(`/v1/appStoreVersions/${version}/appStoreVersionLocalizations?limit=200`);
  const views = (document?.data ?? []).map(viewOf);
  const rows = views.map((view) => ({
    label: view.locale ?? view.id,
    meta: [KEYS.filter((key) => key in view).join(", ") || "empty", view.id].join("  "),
  }));
  return { rows, data: views, noun: "localization" };
}

export async function runMetadataGet(session: AscSession, input: AscInput): Promise<AscOutput> {
  const version = await resolveVersionId(session, input);
  return { value: viewOf(await findLocalization(session, version, requireText(input, "locale"))) };
}

export async function runMetadataUpdate(session: AscSession, input: AscInput): Promise<AscOutput> {
  const attributes = changesOf(input);
  if (Object.keys(attributes).length === 0) {
    throw new UsageError("Nothing to change: pass --whats-new, --description, --keywords, --promotional-text, --support-url or --marketing-url.");
  }
  const locale = requireText(input, "locale");
  const version = await resolveVersionId(session, input);
  const found = await findLocalization(session, version, locale);
  await session.send("patch", `/v1/appStoreVersionLocalizations/${found.id}`, { data: { type: "appStoreVersionLocalizations", id: found.id, attributes } });
  return { value: { id: found.id, locale, ...attributes }, heading: `Updated the ${locale} metadata` };
}

export async function runMetadataAdd(session: AscSession, input: AscInput): Promise<AscOutput> {
  const locale = requireText(input, "locale");
  const version = await resolveVersionId(session, input);
  const created = await session.send(
    "post",
    "/v1/appStoreVersionLocalizations",
    {
      data: {
        type: "appStoreVersionLocalizations",
        attributes: { locale, ...changesOf(input) },
        relationships: { appStoreVersion: linkTo("appStoreVersions", version) },
      },
    },
    "localization",
  );
  if (!created) throw new Error("Apple created no localization.");
  return { value: viewOf(created), heading: `Added ${locale} to version ${version}` };
}
