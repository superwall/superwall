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

interface PlannedOffers {
  /** The subscription PATCH that creates the offers inline. */
  body: ReturnType<typeof bulkSubscriptionPatch>;
  /** Territories the offer goes to. */
  territories: string[];
  /** Territories Apple has no price point for. */
  skipped: string[];
}

/** Everything that can fail without changing anything (price points) happens here, before any write. */
async function planIntroductoryOffer(
  session: AscSession,
  subscription: string,
  terms: OfferTerms,
  territories: readonly string[],
  base: { territory: string; price?: number },
): Promise<PlannedOffers> {
  if (terms.offerMode === "FREE_TRIAL") {
    const body = bulkSubscriptionPatch(subscription, { offers: introductoryOfferEntries(subscription, territories, terms) });
    return { body, territories: [...territories], skipped: [] };
  }
  if (base.price === undefined) throw new UsageError(`A ${terms.offerMode} offer needs --price, in ${base.territory}.`);
  const point = await findPricePoint(session, "subscription", subscription, base.territory, base.price);
  const { points, skipped } = await resolveTerritoryPoints(session, { territory: base.territory, point }, territories);
  const offers = introductoryOfferEntries(subscription, [...points.keys()], terms, points);
  return { body: bulkSubscriptionPatch(subscription, { offers }), territories: [...points.keys()], skipped };
}

export interface OfferReplacement {
  /** Offers that haven't started, or that a new offer starting today replaces: deleted. */
  remove: OfferView[];
  /** Running offers that end the day before the new one starts. */
  end: { offer: OfferView; endDate: string }[];
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

function dayBefore(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return isoDay(date);
}

/**
 * Apple refuses (409) an introductory offer whose dates overlap another one in the same territory,
 * though App Store Connect's own UI replaces it. This plans that replacement for the territories the
 * new offer goes to: an overlapping offer that hasn't started is deleted; one that is running ends
 * the day before the new one starts, or is deleted when the new one starts today. Offers that ended
 * before today, and offers in other territories, are left alone. Dates are inclusive `yyyy-mm-dd`.
 */
export function planOfferReplacement(
  existing: readonly OfferView[],
  territories: readonly string[],
  terms: Pick<OfferTerms, "startDate" | "endDate">,
  today: string,
): OfferReplacement {
  const targets = new Set(territories);
  const start = terms.startDate && terms.startDate > today ? terms.startDate : today;
  const end = terms.endDate;
  const plan: OfferReplacement = { remove: [], end: [] };
  for (const offer of existing) {
    if (!offer.territory || !targets.has(offer.territory)) continue;
    if (offer.endDate && offer.endDate < today) continue;
    const overlaps = (!offer.endDate || offer.endDate >= start) && (!end || !offer.startDate || offer.startDate <= end);
    if (!overlaps) continue;
    const started = !offer.startDate || offer.startDate <= today;
    if (started && start > today) plan.end.push({ offer, endDate: dayBefore(start) });
    else plan.remove.push(offer);
  }
  return plan;
}

function describeReplacement(plan: OfferReplacement): string {
  const where = (offers: readonly OfferView[]) => offers.map((offer) => `${offer.territory} (${offer.id})`).join(", ");
  const lines: string[] = [];
  if (plan.remove.length) lines.push(`Delete ${plural(plan.remove.length, "existing introductory offer")} it overlaps: ${where(plan.remove)}`);
  for (const { offer, endDate } of plan.end) lines.push(`End the running offer in ${where([offer])} on ${endDate}`);
  return lines.join("\n");
}

async function replaceOverlappingOffers(session: AscSession, plan: OfferReplacement, done: string[]): Promise<void> {
  for (const { offer, endDate } of plan.end) {
    await session.send("patch", `/v1/subscriptionIntroductoryOffers/${offer.id}`, {
      data: { type: "subscriptionIntroductoryOffers", id: offer.id, attributes: { endDate } },
    });
    done.push(`ended ${offer.territory} (${offer.id}) on ${endDate}`);
  }
  for (const offer of plan.remove) {
    await session.send("delete", `/v1/subscriptionIntroductoryOffers/${offer.id}`);
    done.push(`deleted ${offer.territory} (${offer.id}, ${[offer.offerMode, offer.duration, offer.customerPrice].filter(Boolean).join(" ")})`);
  }
}

/** A failure after an existing offer was changed says which, so nothing is lost silently. */
async function withReplacedNote(done: readonly string[], write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (error) {
    if (done.length === 0) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\nThe new offer wasn't created, but existing offers were already changed: ${done.join("; ")}. Recreate them with \`asc offers create\` if you need them back.`);
  }
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
  const planned = await planIntroductoryOffer(session, subscription, terms, territories, base);
  const replacement = planOfferReplacement(await listIntroductoryOffers(session, subscription), planned.territories, terms, isoDay(new Date()));
  const replacing = replacement.remove.length + replacement.end.length > 0;
  if (replacing) {
    await assertConfirmed(session, input.yes, `${describeReplacement(replacement)}\nthen create the new ${terms.offerMode} offer in ${plural(planned.territories.length, "territory")}`);
  }
  const done: string[] = [];
  await withReplacedNote(done, async () => {
    await replaceOverlappingOffers(session, replacement, done);
    await session.send("patch", `/v1/subscriptions/${subscription}`, planned.body);
  });
  if (session.dryRun) return { value: undefined };
  const offers = await listIntroductoryOffers(session, subscription);
  const replaced = {
    deleted: replacement.remove.map((offer) => offer.id),
    ended: replacement.end.map(({ offer, endDate }) => ({ id: offer.id, endDate })),
  };
  return {
    value: {
      introductoryOffers: offers,
      ...(replacing ? { replaced } : {}),
      ...(planned.skipped.length ? { skippedTerritories: planned.skipped } : {}),
    },
    heading:
      `Created a ${terms.offerMode} introductory offer in ${plural(planned.territories.length, "territory")}` +
      (replacing ? `, replacing ${plural(replacement.remove.length + replacement.end.length, "overlapping offer")}` : ""),
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
