import { attribute, selectIncluded, linkTo, relatedId, type AscDocument, type AscResource } from "./json-api";
import { booleanOf, numberOf, plural, requireNumber, textOf, type AscInput, type AscOutput } from "./operation";
import { selectAvailability } from "./availability";
import { bulkSubscriptionPatch, findPricePoint, listPricePoints, resolveTerritoryPoints, subscriptionPriceEntries, type PricedKind } from "./pricing";
import { placeholder, type AscSession } from "./session";
import { resolveTarget } from "./targets";

const PRICED: readonly PricedKind[] = ["subscription", "iap"];
const DEFAULT_TERRITORY = "USA";

export interface PriceView {
  id: string;
  territory?: string;
  customerPrice?: string;
  proceeds?: string;
  startDate?: string;
  planType?: string;
  manual?: boolean;
}

function viewOfPrice(document: AscDocument, price: AscResource, pointType: string, pointKey: string): PriceView {
  const point = selectIncluded(document, pointType, relatedId(price, pointKey));
  const view: PriceView = { id: price.id };
  const territory = relatedId(price, "territory");
  if (territory) view.territory = territory;
  const customerPrice = point ? attribute(point, "customerPrice") : undefined;
  if (customerPrice) view.customerPrice = customerPrice;
  const proceeds = point ? attribute(point, "proceeds") : undefined;
  if (proceeds) view.proceeds = proceeds;
  const startDate = attribute(price, "startDate");
  if (startDate) view.startDate = startDate;
  const planType = attribute(price, "planType");
  if (planType) view.planType = planType;
  if (typeof price.attributes.manual === "boolean") view.manual = price.attributes.manual;
  return view;
}

export async function listSubscriptionPrices(session: AscSession, id: string): Promise<PriceView[]> {
  const document = await session.list(
    `/v1/subscriptions/${id}/prices?include=subscriptionPricePoint,territory&limit=200&fields[subscriptionPricePoints]=customerPrice,proceeds`,
  );
  if (!document) return [];
  return document.data.map((price) => viewOfPrice(document, price, "subscriptionPricePoints", "subscriptionPricePoint"));
}

export interface IapPriceSchedule {
  id: string;
  baseTerritory?: string;
  prices: PriceView[];
}

export async function selectIapPriceSchedule(session: AscSession, id: string): Promise<IapPriceSchedule | undefined> {
  const schedule = await session.select(`/v2/inAppPurchases/${id}/iapPriceSchedule?include=baseTerritory`);
  if (!schedule) return undefined;
  const prices: PriceView[] = [];
  for (const kind of ["manualPrices", "automaticPrices"]) {
    const document = await session.list(
      `/v1/inAppPurchasePriceSchedules/${schedule.id}/${kind}?include=inAppPurchasePricePoint,territory&limit=200&fields[inAppPurchasePricePoints]=customerPrice,proceeds`,
    );
    if (document) prices.push(...document.data.map((price) => viewOfPrice(document, price, "inAppPurchasePricePoints", "inAppPurchasePricePoint")));
  }
  const baseTerritory = relatedId(schedule, "baseTerritory");
  return { id: schedule.id, ...(baseTerritory ? { baseTerritory } : {}), prices };
}

const priceRows = (prices: readonly PriceView[]) =>
  prices.map((price) => ({
    label: price.territory ?? price.id,
    meta: [price.customerPrice, price.startDate ? `from ${price.startDate}` : "", price.manual === false ? "equalized" : ""].filter(Boolean).join("  "),
  }));

export async function runPricesList(session: AscSession, input: AscInput): Promise<AscOutput> {
  const { kind, id } = resolveTarget(input, PRICED);
  if (kind === "subscription") {
    const prices = await listSubscriptionPrices(session, id);
    return { rows: priceRows(prices), data: prices, noun: "price" };
  }
  const prices = (await selectIapPriceSchedule(session, id))?.prices ?? [];
  return { rows: priceRows(prices), data: prices, noun: "price" };
}

export async function runPricesPoints(session: AscSession, input: AscInput): Promise<AscOutput> {
  const { kind, id } = resolveTarget(input, PRICED);
  const territory = textOf(input, "territory") ?? DEFAULT_TERRITORY;
  const price = numberOf(input, "price");
  const points = await listPricePoints(session, kind, id, territory);
  const matching = price === undefined ? points : points.filter((point) => Number(point.customerPrice) === price);
  if (price !== undefined && matching.length === 0) throw new Error(`Apple has no ${territory} price point at ${price}.`);
  return {
    rows: matching.map((point) => ({ label: point.customerPrice ?? point.id, meta: `proceeds ${point.proceeds ?? "?"}  ${point.id}` })),
    data: matching,
    noun: "price point",
  };
}

export async function replaceIapPrice(session: AscSession, id: string, territory: string, price: number): Promise<void> {
  const point = await findPricePoint(session, "iap", id, territory, price);
  const local = placeholder(`price-${territory}`);
  await session.send("post", "/v1/inAppPurchasePriceSchedules", {
    data: {
      type: "inAppPurchasePriceSchedules",
      relationships: {
        inAppPurchase: linkTo("inAppPurchases", id),
        baseTerritory: linkTo("territories", territory),
        manualPrices: { data: [{ type: "inAppPurchasePrices", id: local }] },
      },
    },
    included: [
      {
        type: "inAppPurchasePrices",
        id: local,
        attributes: { startDate: null },
        relationships: {
          inAppPurchasePricePoint: linkTo("inAppPurchasePricePoints", point),
          inAppPurchaseV2: linkTo("inAppPurchases", id),
        },
      },
    ],
  });
}

async function replaceSubscriptionPrices(
  session: AscSession,
  id: string,
  base: { territory: string; price: number },
  territories: readonly string[],
  options: { startDate?: string; preserveCurrentPrice?: boolean },
): Promise<string[]> {
  const point = await findPricePoint(session, "subscription", id, base.territory, base.price);
  const { points, skipped } = await resolveTerritoryPoints(session, { territory: base.territory, point }, territories);
  await session.send("patch", `/v1/subscriptions/${id}`, bulkSubscriptionPatch(id, { prices: subscriptionPriceEntries(points, options) }));
  return skipped;
}

export async function runPricesSet(session: AscSession, input: AscInput): Promise<AscOutput> {
  const { kind, id } = resolveTarget(input, PRICED);
  const territory = textOf(input, "territory") ?? DEFAULT_TERRITORY;
  const price = requireNumber(input, "price");
  if (kind === "iap") {
    await replaceIapPrice(session, id, territory, price);
    if (session.dryRun) return { value: undefined };
    return { value: await selectIapPriceSchedule(session, id), heading: `Priced at ${price} in ${territory}; Apple equalizes the other territories` };
  }
  const availability = await selectAvailability(session, "subscription", id);
  if (!availability || availability.territories.length === 0) {
    throw new Error(`Subscription ${id} isn't available anywhere yet: superwall asc availability set --subscription ${id} --available-territories all`);
  }
  const options = { startDate: textOf(input, "startDate"), preserveCurrentPrice: booleanOf(input, "preserveCurrentPrice") };
  const skipped = await replaceSubscriptionPrices(session, id, { territory, price }, availability.territories, options);
  if (session.dryRun) return { value: undefined };
  const territories = availability.territories.length - skipped.length;
  return {
    value: { prices: await listSubscriptionPrices(session, id), ...(skipped.length ? { skippedTerritories: skipped } : {}) },
    heading: `Priced at ${price} in ${territory}, equalized across ${plural(territories, "territory")}`,
  };
}
