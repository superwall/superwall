import { UsageError } from "@/program/command";
import { attribute, selectIncluded, numberAttribute, relatedId } from "./json-api";
import { argOf, numberOf, plural, requireText, textOf, type AscInput, type AscOutput } from "./operation";
import { selectAvailability } from "./availability";
import { bulkSubscriptionPatch, findPricePoint, introductoryOfferEntries, resolveTerritoryPoints, type OfferTerms } from "./pricing";
import { assertConfirmed, type AscSession } from "./session";
import { resolveTerritories } from "./targets";

export const OFFER_DURATIONS = ["THREE_DAYS", "ONE_WEEK", "TWO_WEEKS", "ONE_MONTH", "TWO_MONTHS", "THREE_MONTHS", "SIX_MONTHS", "ONE_YEAR"] as const;
export const OFFER_MODES = ["FREE_TRIAL", "PAY_AS_YOU_GO", "PAY_UP_FRONT"] as const;
const DEFAULT_TERRITORY = "USA";

export interface OfferView {
  id: string;
  territory?: string;
  offerMode?: string;
  duration?: string;
  numberOfPeriods?: number;
  startDate?: string;
  endDate?: string;
  customerPrice?: string;
}

const OFFER_KEYS = ["offerMode", "duration", "startDate", "endDate"] as const;

export async function listIntroductoryOffers(session: AscSession, id: string): Promise<OfferView[]> {
  const document = await session.list(
    `/v1/subscriptions/${id}/introductoryOffers?include=territory,subscriptionPricePoint&limit=200&fields[subscriptionPricePoints]=customerPrice`,
  );
  if (!document) return [];
  return document.data.map((offer) => {
    const view: OfferView = { id: offer.id };
    const territory = relatedId(offer, "territory");
    if (territory) view.territory = territory;
    for (const key of OFFER_KEYS) {
      const value = attribute(offer, key);
      if (value !== undefined) view[key] = value;
    }
    const periods = numberAttribute(offer, "numberOfPeriods");
    if (periods !== undefined) view.numberOfPeriods = periods;
    const point = selectIncluded(document, "subscriptionPricePoints", relatedId(offer, "subscriptionPricePoint"));
    const customerPrice = point ? attribute(point, "customerPrice") : undefined;
    if (customerPrice) view.customerPrice = customerPrice;
    return view;
  });
}

const offerRows = (offers: readonly OfferView[]) =>
  offers.map((offer) => ({
    label: offer.territory ?? offer.id,
    meta: [offer.offerMode, offer.duration, offer.customerPrice, offer.endDate ? `until ${offer.endDate}` : "", offer.id].filter(Boolean).join("  "),
  }));

export async function runOffersList(session: AscSession, input: AscInput): Promise<AscOutput> {
  const offers = await listIntroductoryOffers(session, requireText(input, "subscription"));
  return { rows: offerRows(offers), data: offers, noun: "introductory offer" };
}

async function resolveOfferTerritories(session: AscSession, subscription: string, value: string | undefined): Promise<string[]> {
  if (value) return resolveTerritories(session, value);
  const availability = await selectAvailability(session, "subscription", subscription);
  if (!availability || availability.territories.length === 0) {
    throw new Error(`Subscription ${subscription} isn't available anywhere yet: pass --available-territories, or set its availability first.`);
  }
  return availability.territories;
}

async function createIntroductoryOffer(
  session: AscSession,
  subscription: string,
  terms: OfferTerms,
  territories: readonly string[],
  base: { territory: string; price?: number },
): Promise<string[]> {
  if (terms.offerMode === "FREE_TRIAL") {
    await session.send("patch", `/v1/subscriptions/${subscription}`, bulkSubscriptionPatch(subscription, { offers: introductoryOfferEntries(subscription, territories, terms) }));
    return [];
  }
  if (base.price === undefined) throw new UsageError(`A ${terms.offerMode} offer needs --price, in ${base.territory}.`);
  const point = await findPricePoint(session, "subscription", subscription, base.territory, base.price);
  const { points, skipped } = await resolveTerritoryPoints(session, { territory: base.territory, point }, territories);
  const offers = introductoryOfferEntries(subscription, [...points.keys()], terms, points);
  await session.send("patch", `/v1/subscriptions/${subscription}`, bulkSubscriptionPatch(subscription, { offers }));
  return skipped;
}

export async function runOffersCreate(session: AscSession, input: AscInput): Promise<AscOutput> {
  const subscription = requireText(input, "subscription");
  const startDate = textOf(input, "startDate");
  const endDate = textOf(input, "endDate");
  const terms: OfferTerms = {
    offerMode: requireText(input, "offerMode"),
    duration: requireText(input, "duration"),
    numberOfPeriods: numberOf(input, "numberOfPeriods") ?? 1,
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  };
  const territories = await resolveOfferTerritories(session, subscription, textOf(input, "availableTerritories"));
  const base = { territory: textOf(input, "territory") ?? DEFAULT_TERRITORY, price: numberOf(input, "price") };
  const skipped = await createIntroductoryOffer(session, subscription, terms, territories, base);
  if (session.dryRun) return { value: undefined };
  const offers = await listIntroductoryOffers(session, subscription);
  return {
    value: { introductoryOffers: offers, ...(skipped.length ? { skippedTerritories: skipped } : {}) },
    heading: `Created a ${terms.offerMode} introductory offer in ${plural(territories.length - skipped.length, "territory")}`,
  };
}

export async function runOffersUpdate(session: AscSession, input: AscInput): Promise<AscOutput> {
  const id = argOf(input, "id");
  const endDate = requireText(input, "endDate");
  const updated = await session.send("patch", `/v1/subscriptionIntroductoryOffers/${id}`, {
    data: { type: "subscriptionIntroductoryOffers", id, attributes: { endDate } },
  });
  return { value: { id, endDate: updated ? attribute(updated, "endDate") : endDate }, heading: `The offer now ends ${endDate}` };
}

async function resolveOfferIds(session: AscSession, one: string | undefined, subscription: string | undefined): Promise<string[]> {
  if (one) return [one];
  if (!subscription) throw new UsageError("Pass the offer's <id>, or --subscription <id> to delete all of its introductory offers.");
  return (await listIntroductoryOffers(session, subscription)).map((offer) => offer.id);
}

export async function runOffersDelete(session: AscSession, input: AscInput): Promise<AscOutput> {
  const one = input.args.id;
  const subscription = textOf(input, "subscription");
  const ids = await resolveOfferIds(session, one, subscription);
  await assertConfirmed(session, input.yes, one ? `Delete introductory offer ${one}` : `Delete ${plural(ids.length, "introductory offer")} of subscription ${subscription}`);
  for (const id of ids) await session.send("delete", `/v1/subscriptionIntroductoryOffers/${id}`);
  return { value: { deleted: ids }, heading: `Deleted ${plural(ids.length, "introductory offer")}` };
}
