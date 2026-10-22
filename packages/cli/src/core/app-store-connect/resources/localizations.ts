import { UsageError } from "@/program/command";
import { attribute, compact, linkTo, type AscResource } from "./json-api";
import { requireText, textOf, type AscInput, type AscOutput } from "./operation";
import { assertConfirmed, isPlaceholder, placeholder, type AscSession } from "./session";
import { selectLatestVersion, KINDS, resolveDraftVersion, resolveTarget, type ProductKind } from "./targets";

const ALL_KINDS: readonly ProductKind[] = ["subscription", "group", "iap"];

export interface LocalizationView {
  id: string;
  locale?: string;
  name?: string;
  description?: string;
  customAppName?: string;
  state?: string;
}

const VIEW_KEYS = ["locale", "name", "description", "customAppName", "state"] as const;

function viewOfLocalization(resource: AscResource): LocalizationView {
  const view: LocalizationView = { id: resource.id };
  for (const key of VIEW_KEYS) {
    const value = attribute(resource, key);
    if (value !== undefined) view[key] = value;
  }
  return view;
}

export async function listVersionLocalizations(session: AscSession, kind: ProductKind, version: string | undefined): Promise<LocalizationView[]> {
  if (!version) return [];
  const document = await session.list(KINDS[kind].localizations(version));
  return (document?.data ?? []).map(viewOfLocalization);
}

export interface LocalizedText {
  locale: string;
  name: string;
  description?: string;
  customAppName?: string;
}

function localizedAttributes(kind: ProductKind, text: Partial<LocalizedText>): Record<string, unknown> {
  const fields = KINDS[kind].localizedFields;
  if (text.description !== undefined && !fields.includes("description")) throw new UsageError("A subscription group's localization has no --description; it takes --custom-app-name.");
  if (text.customAppName !== undefined && !fields.includes("customAppName")) throw new UsageError("Only a subscription group's localization takes --custom-app-name.");
  return compact({ name: text.name, description: text.description, customAppName: text.customAppName });
}

export async function createLocalization(session: AscSession, kind: ProductKind, version: string, text: LocalizedText): Promise<AscResource | undefined> {
  const spec = KINDS[kind];
  return session.send(
    "post",
    spec.localizationPath,
    {
      data: {
        type: spec.localizationType,
        attributes: { locale: text.locale, ...localizedAttributes(kind, text) },
        relationships: { version: linkTo(spec.versionType, version) },
      },
    },
    "localization",
  );
}

async function findLocalization(session: AscSession, kind: ProductKind, version: string, locale: string, owner: string): Promise<string> {
  if (isPlaceholder(version)) {
    await session.get(KINDS[kind].localizations(version));
    return placeholder("localization");
  }
  const found = (await listVersionLocalizations(session, kind, version)).find((localization) => localization.locale === locale);
  if (!found) throw new Error(`The ${KINDS[kind].noun} ${owner} has no ${locale} localization. Add one with superwall asc localizations add.`);
  return found.id;
}

function textFlags(input: AscInput): Partial<LocalizedText> {
  return { name: textOf(input, "name"), description: textOf(input, "description"), customAppName: textOf(input, "customAppName") };
}

export async function runLocalizationsList(session: AscSession, input: AscInput): Promise<AscOutput> {
  const target = resolveTarget(input, ALL_KINDS);
  const latest = await selectLatestVersion(session, target.kind, target.id);
  const localizations = await listVersionLocalizations(session, target.kind, latest?.id);
  return {
    rows: localizations.map((localization) => ({
      label: localization.locale ?? localization.id,
      meta: [localization.name, localization.state, localization.id].filter(Boolean).join("  "),
    })),
    data: localizations,
    noun: "localization",
  };
}

export async function runLocalizationsAdd(session: AscSession, input: AscInput): Promise<AscOutput> {
  const target = resolveTarget(input, ALL_KINDS);
  const text = { ...textFlags(input), locale: requireText(input, "locale"), name: requireText(input, "name") };
  localizedAttributes(target.kind, text);
  const version = await resolveDraftVersion(session, target.kind, target.id);
  const created = await createLocalization(session, target.kind, version, text);
  return { value: created ? viewOfLocalization(created) : undefined, heading: `Added the ${text.locale} localization` };
}

export async function runLocalizationsUpdate(session: AscSession, input: AscInput): Promise<AscOutput> {
  const target = resolveTarget(input, ALL_KINDS);
  const locale = requireText(input, "locale");
  const attributes = localizedAttributes(target.kind, textFlags(input));
  if (Object.keys(attributes).length === 0) throw new UsageError(`Nothing to change: pass --name, --description or --custom-app-name.`);
  const version = await resolveDraftVersion(session, target.kind, target.id);
  const id = await findLocalization(session, target.kind, version, locale, target.id);
  const spec = KINDS[target.kind];
  const updated = await session.send("patch", `${spec.localizationPath}/${id}`, { data: { type: spec.localizationType, id, attributes } });
  return { value: updated ? viewOfLocalization(updated) : undefined, heading: `Updated the ${locale} localization` };
}

export async function runLocalizationsDelete(session: AscSession, input: AscInput): Promise<AscOutput> {
  const target = resolveTarget(input, ALL_KINDS);
  const locale = requireText(input, "locale");
  const version = await resolveDraftVersion(session, target.kind, target.id);
  const id = await findLocalization(session, target.kind, version, locale, target.id);
  await assertConfirmed(session, input.yes, `Delete the ${locale} localization of ${KINDS[target.kind].noun} ${target.id}`);
  await session.send("delete", `${KINDS[target.kind].localizationPath}/${id}`);
  return { value: { id, locale, deleted: true }, heading: `Deleted the ${locale} localization` };
}
