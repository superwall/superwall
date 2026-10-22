import { attribute, compact, linkTo, relatedId, type AscResource } from "./json-api";
import { placeholder, type AscSession } from "./session";

export type PricedKind = "subscription" | "iap";

const POINTS: Record<PricedKind, (id: string, territory: string) => string> = {
  subscription: (id, territory) =>
    `/v1/subscriptions/${id}/pricePoints?filter[territory]=${territory}&limit=200&fields[subscriptionPricePoints]=customerPrice,proceeds`,
  iap: (id, territory) =>
    `/v2/inAppPurchases/${id}/pricePoints?filter[territory]=${territory}&limit=200&fields[inAppPurchasePricePoints]=customerPrice,proceeds`,
};

export interface PricePoint {
  id: string;
  customerPrice?: string;
  proceeds?: string;
}

const pointOf = (resource: AscResource): PricePoint => ({
  id: resource.id,
  customerPrice: attribute(resource, "customerPrice"),
  proceeds: attribute(resource, "proceeds"),
});

export async function listPricePoints(session: AscSession, kind: PricedKind, id: string, territory: string): Promise<PricePoint[]> {
  const document = await session.list(POINTS[kind](id, territory));
  return (document?.data ?? []).map(pointOf);
}

function closest(prices: number[], price: number): string {
  return [...prices]
    .sort((a, b) => Math.abs(a - price) - Math.abs(b - price))
    .slice(0, 3)
    .sort((a, b) => a - b)
    .map((value) => value.toFixed(2))
    .join(", ");
}

export async function findPricePoint(session: AscSession, kind: PricedKind, id: string, territory: string, price: number): Promise<string> {
  let document = await session.get(POINTS[kind](id, territory));
  if (!document) return placeholder(`price-point-${territory}`);
  const seen: number[] = [];
  for (;;) {
    for (const point of document.data) {
      const customerPrice = Number(attribute(point, "customerPrice"));
      if (customerPrice === price) return point.id;
      if (Number.isFinite(customerPrice)) seen.push(customerPrice);
    }
    if (!document.next) break;
    document = await session.next(document.next);
  }
  const near = seen.length ? ` The closest: ${closest(seen, price)}.` : "";
  throw new Error(`Apple has no ${territory} price point at ${price}.${near}`);
}

async function listEqualizations(session: AscSession, point: string): Promise<Map<string, string> | undefined> {
  const document = await session.list(
    `/v1/subscriptionPricePoints/${point}/equalizations?include=territory&limit=200&fields[subscriptionPricePoints]=customerPrice,territory`,
  );
  if (!document) return undefined;
  const byTerritory = new Map<string, string>();
  for (const equalized of document.data) {
    const territory = relatedId(equalized, "territory");
    if (territory) byTerritory.set(territory, equalized.id);
  }
  return byTerritory;
}

export interface TerritoryPoints {
  points: Map<string, string>;
  skipped: string[];
}

export async function resolveTerritoryPoints(
  session: AscSession,
  base: { territory: string; point: string },
  territories: readonly string[],
): Promise<TerritoryPoints> {
  const equalized = await listEqualizations(session, base.point);
  const points = new Map<string, string>();
  const skipped: string[] = [];
  for (const territory of new Set([base.territory, ...territories])) {
    const point = territory === base.territory ? base.point : (equalized ? equalized.get(territory) : placeholder(`price-point-${territory}`));
    if (point) points.set(territory, point);
    else skipped.push(territory);
  }
  return { points, skipped };
}

export interface PriceOptions {
  startDate?: string;
  preserveCurrentPrice?: boolean;
}

export function subscriptionPriceEntries(points: Map<string, string>, options: PriceOptions): Record<string, unknown>[] {
  return [...points].map(([territory, point]) => ({
    type: "subscriptionPrices",
    id: placeholder(`price-${territory}`),
    attributes: compact({
      startDate: options.startDate ?? null,
      preserveCurrentPrice: options.preserveCurrentPrice ?? false,
      planType: "UPFRONT",
    }),
    relationships: {
      subscriptionPricePoint: linkTo("subscriptionPricePoints", point),
      territory: linkTo("territories", territory),
    },
  }));
}

export interface OfferTerms {
  duration: string;
  offerMode: string;
  numberOfPeriods: number;
  startDate?: string;
  endDate?: string;
}

export function introductoryOfferEntries(
  subscription: string,
  territories: readonly string[],
  terms: OfferTerms,
  points?: Map<string, string>,
): Record<string, unknown>[] {
  return territories.map((territory) => {
    const point = points?.get(territory);
    return {
      type: "subscriptionIntroductoryOffers",
      id: placeholder(`offer-${territory}`),
      attributes: compact({ ...terms }),
      relationships: {
        subscription: linkTo("subscriptions", subscription),
        territory: linkTo("territories", territory),
        ...(point ? { subscriptionPricePoint: linkTo("subscriptionPricePoints", point) } : {}),
      },
    };
  });
}

export function bulkSubscriptionPatch(subscription: string, included: { prices?: Record<string, unknown>[]; offers?: Record<string, unknown>[] }) {
  const prices = included.prices ?? [];
  const offers = included.offers ?? [];
  const ids = (entries: Record<string, unknown>[], type: string) => ({ data: entries.map((entry) => ({ type, id: entry.id })) });
  return {
    data: {
      type: "subscriptions",
      id: subscription,
      relationships: {
        ...(prices.length ? { prices: ids(prices, "subscriptionPrices") } : {}),
        ...(offers.length ? { introductoryOffers: ids(offers, "subscriptionIntroductoryOffers") } : {}),
      },
    },
    included: [...prices, ...offers],
  };
}
