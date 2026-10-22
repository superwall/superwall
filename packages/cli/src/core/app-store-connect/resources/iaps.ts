import { UsageError } from "@/program/command";
import { attribute, compact, linkTo, type AscResource } from "./json-api";
import { selectAvailability, upsertAvailability, type AvailabilityView } from "./availability";
import { createLocalization, listVersionLocalizations, type LocalizationView } from "./localizations";
import { argOf, booleanOf, numberOf, requireText, textOf, type AscInput, type AscOutput } from "./operation";
import { selectIapPriceSchedule, replaceIapPrice, type IapPriceSchedule } from "./prices";
import { selectScreenshot, type ScreenshotView } from "./screenshots";
import { assertConfirmed, type AscSession } from "./session";
import { selectLatestVersion, resolveAscAppId, resolveTerritories, type VersionView } from "./targets";

export const IAP_TYPES = ["CONSUMABLE", "NON_CONSUMABLE", "NON_RENEWING_SUBSCRIPTION"] as const;
const DEFAULT_LOCALE = "en-US";
const DEFAULT_TERRITORY = "USA";

interface IapRow {
  id: string;
  productId?: string;
  name?: string;
  inAppPurchaseType?: string;
  state?: string;
}

function rowOf(iap: AscResource): IapRow {
  return {
    id: iap.id,
    productId: attribute(iap, "productId"),
    name: attribute(iap, "name"),
    inAppPurchaseType: attribute(iap, "inAppPurchaseType"),
    state: attribute(iap, "state"),
  };
}

export interface IapView extends IapRow {
  familySharable?: boolean;
  reviewNote?: string;
  version?: VersionView;
  localizations: LocalizationView[];
  priceSchedule: IapPriceSchedule | null;
  availability: AvailabilityView | null;
  reviewScreenshot: ScreenshotView | null;
  missing: string[];
}

async function findIap(session: AscSession, id: string): Promise<IapView> {
  const iap = (await session.get(`/v2/inAppPurchases/${id}`))?.one;
  if (!iap) throw new Error(`No in-app purchase ${id}.`);
  const version = await selectLatestVersion(session, "iap", id);
  const localizations = await listVersionLocalizations(session, "iap", version?.id);
  const priceSchedule = await selectIapPriceSchedule(session, id);
  const availability = await selectAvailability(session, "iap", id);
  const reviewScreenshot = await selectScreenshot(session, "iap", id);
  const familySharable = iap.attributes.familySharable;
  const reviewNote = attribute(iap, "reviewNote");
  return {
    ...rowOf(iap),
    ...(typeof familySharable === "boolean" ? { familySharable } : {}),
    ...(reviewNote ? { reviewNote } : {}),
    ...(version ? { version } : {}),
    localizations,
    priceSchedule: priceSchedule ?? null,
    availability: availability ?? null,
    reviewScreenshot: reviewScreenshot ?? null,
    missing: [
      ...(localizations.length ? [] : ["localization"]),
      ...(priceSchedule?.prices.length ? [] : ["price"]),
      ...(availability?.territories.length ? [] : ["availability"]),
      ...(reviewScreenshot ? [] : ["review screenshot"]),
    ],
  };
}

export async function runIapsList(session: AscSession, input: AscInput): Promise<AscOutput> {
  const app = await resolveAscAppId(session, argOf(input, "asc-app"));
  const filters = [
    ["productId", textOf(input, "productId")],
    ["state", textOf(input, "state")],
    ["inAppPurchaseType", textOf(input, "inAppPurchaseType")],
  ].flatMap(([key, value]) => (value ? [`&filter[${key}]=${encodeURIComponent(value)}`] : []));
  const document = await session.list(`/v1/apps/${app}/inAppPurchasesV2?limit=200${filters.join("")}`);
  const rows = (document?.data ?? []).map(rowOf);
  return {
    rows: rows.map((row) => ({ label: row.productId ?? row.id, meta: [row.name, row.inAppPurchaseType, row.state, row.id].filter(Boolean).join("  ") })),
    data: rows,
    noun: "in-app purchase",
  };
}

export async function runIapsGet(session: AscSession, input: AscInput): Promise<AscOutput> {
  return { value: await findIap(session, argOf(input, "id")) };
}

function iapAttributes(input: AscInput): Record<string, unknown> {
  return compact({ name: textOf(input, "name"), reviewNote: textOf(input, "reviewNote"), familySharable: booleanOf(input, "familySharable") });
}

export async function runIapsCreate(session: AscSession, input: AscInput): Promise<AscOutput> {
  const app = await resolveAscAppId(session, requireText(input, "ascApp"));
  const productId = requireText(input, "productId");
  const iap = await session.send(
    "post",
    "/v2/inAppPurchases",
    {
      data: {
        type: "inAppPurchases",
        attributes: { productId, inAppPurchaseType: requireText(input, "inAppPurchaseType"), ...iapAttributes(input) },
        relationships: { app: linkTo("apps", app) },
      },
    },
    "iap",
  );
  if (!iap) throw new Error("Apple created no in-app purchase.");
  const id = iap.id;

  const displayName = textOf(input, "displayName");
  if (displayName) {
    const version = await selectLatestVersion(session, "iap", id);
    if (!version) throw new Error(`Apple made no version of in-app purchase ${id} to localize.`);
    const description = textOf(input, "description");
    await createLocalization(session, "iap", version.id, {
      locale: textOf(input, "locale") ?? DEFAULT_LOCALE,
      name: displayName,
      ...(description ? { description } : {}),
    });
  }

  const available = textOf(input, "availableTerritories") ?? "all";
  const territories = await resolveTerritories(session, available);
  const newTerritories = booleanOf(input, "availableInNewTerritories") ?? available.toLowerCase() === "all";
  await upsertAvailability(session, "iap", id, territories, newTerritories, undefined);
  const price = numberOf(input, "price");
  if (price !== undefined) await replaceIapPrice(session, id, textOf(input, "territory") ?? DEFAULT_TERRITORY, price);

  if (session.dryRun) return { value: undefined };
  const view = await findIap(session, id);
  const still = view.missing.length ? `; still missing: ${view.missing.join(", ")}` : "";
  return { value: view, heading: `Created ${productId} (${view.state ?? "state unknown"})${still}` };
}

export async function runIapsUpdate(session: AscSession, input: AscInput): Promise<AscOutput> {
  const id = argOf(input, "id");
  const attributes = iapAttributes(input);
  if (Object.keys(attributes).length === 0) throw new UsageError("Nothing to change: pass --name, --review-note or --family-sharable.");
  await session.send("patch", `/v2/inAppPurchases/${id}`, { data: { type: "inAppPurchases", id, attributes } });
  return { value: { id, ...attributes }, heading: `Updated in-app purchase ${id}` };
}

export async function runIapsDelete(session: AscSession, input: AscInput): Promise<AscOutput> {
  const id = argOf(input, "id");
  await assertConfirmed(session, input.yes, `Delete in-app purchase ${id}`);
  await session.send("delete", `/v2/inAppPurchases/${id}`);
  return { value: { id, deleted: true }, heading: `Deleted in-app purchase ${id}` };
}
