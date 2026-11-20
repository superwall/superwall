import { UsageError } from "@/program/command";
import { attribute, compact, selectIncluded, linkTo, numberAttribute, relatedId, type AscResource } from "./json-api";
import { selectAvailability, upsertAvailability, type AvailabilityView } from "./availability";
import { createLocalization, listVersionLocalizations, type LocalizationView } from "./localizations";
import { listIntroductoryOffers, type OfferView } from "./offers";
import { argOf, booleanOf, numberOf, requireNumber, requireText, textOf, type AscInput, type AscOutput } from "./operation";
import { listSubscriptionPrices, type PriceView } from "./prices";
import { bulkSubscriptionPatch, findPricePoint, introductoryOfferEntries, resolveTerritoryPoints, subscriptionPriceEntries } from "./pricing";
import { selectScreenshot, type ScreenshotView } from "./screenshots";
import { AscRequestError, statusOf } from "../api/errors";
import { assertConfirmed, type AscSession } from "./session";
import { resolveDraftVersion, selectLatestVersion, resolveAscAppId, resolveGroupId, resolveTerritories, type VersionView } from "./targets";

export const SUBSCRIPTION_PERIODS = ["ONE_WEEK", "ONE_MONTH", "TWO_MONTHS", "THREE_MONTHS", "SIX_MONTHS", "ONE_YEAR"] as const;
const DEFAULT_LOCALE = "en-US";
const DEFAULT_TERRITORY = "USA";

interface SubscriptionRow {
  id: string;
  productId?: string;
  name?: string;
  state?: string;
  subscriptionPeriod?: string;
  groupLevel?: number;
  group: { id: string; referenceName?: string };
}

function rowOf(subscription: AscResource, group: { id: string; referenceName?: string }): SubscriptionRow {
  return {
    id: subscription.id,
    productId: attribute(subscription, "productId"),
    name: attribute(subscription, "name"),
    state: attribute(subscription, "state"),
    subscriptionPeriod: attribute(subscription, "subscriptionPeriod"),
    groupLevel: numberAttribute(subscription, "groupLevel"),
    group,
  };
}

export interface SubscriptionView extends SubscriptionRow {
  familySharable?: boolean;
  reviewNote?: string;
  version?: VersionView;
  localizations: LocalizationView[];
  prices: PriceView[];
  introductoryOffers: OfferView[];
  availability: AvailabilityView | null;
  reviewScreenshot: ScreenshotView | null;
  missing: string[];
}

async function findSubscription(session: AscSession, id: string): Promise<SubscriptionView> {
  const document = await session.get(`/v1/subscriptions/${id}?include=group`);
  const subscription = document?.one;
  if (!document || !subscription) throw new Error(`No subscription ${id}.`);
  const groupId = relatedId(subscription, "group") ?? "";
  const included = selectIncluded(document, "subscriptionGroups", groupId);
  const groupName = included ? attribute(included, "referenceName") : undefined;
  const version = await selectLatestVersion(session, "subscription", id);
  const localizations = await listVersionLocalizations(session, "subscription", version?.id);
  const prices = await listSubscriptionPrices(session, id);
  const introductoryOffers = await listIntroductoryOffers(session, id);
  const availability = await selectAvailability(session, "subscription", id);
  const reviewScreenshot = await selectScreenshot(session, "subscription", id);
  const missing = [
    ...(localizations.length ? [] : ["localization"]),
    ...(prices.length ? [] : ["price"]),
    ...(availability?.territories.length ? [] : ["availability"]),
    ...(reviewScreenshot ? [] : ["review screenshot"]),
  ];
  const familySharable = subscription.attributes.familySharable;
  const reviewNote = attribute(subscription, "reviewNote");
  return {
    ...rowOf(subscription, { id: groupId, ...(groupName ? { referenceName: groupName } : {}) }),
    ...(typeof familySharable === "boolean" ? { familySharable } : {}),
    ...(reviewNote ? { reviewNote } : {}),
    ...(version ? { version } : {}),
    localizations,
    prices,
    introductoryOffers,
    availability: availability ?? null,
    reviewScreenshot: reviewScreenshot ?? null,
    missing,
  };
}

const subscriptionRows = (rows: readonly SubscriptionRow[]) =>
  rows.map((row) => ({
    label: row.productId ?? row.id,
    meta: [row.name, row.subscriptionPeriod, row.state, row.group.referenceName, row.id].filter(Boolean).join("  "),
  }));

async function listGroupSubscriptions(session: AscSession, group: { id: string; referenceName?: string }): Promise<SubscriptionRow[]> {
  const document = await session.list(`/v1/subscriptionGroups/${group.id}/subscriptions?limit=200`);
  return (document?.data ?? []).map((subscription) => rowOf(subscription, group));
}

export async function runSubscriptionsList(session: AscSession, input: AscInput): Promise<AscOutput> {
  const ascApp = input.args["asc-app"];
  const group = textOf(input, "group");
  const rows: SubscriptionRow[] = [];
  if (group) {
    rows.push(...(await listGroupSubscriptions(session, { id: await resolveGroupId(session, group, ascApp) })));
  } else if (ascApp) {
    const app = await resolveAscAppId(session, ascApp);
    const groups = await session.list(`/v1/apps/${app}/subscriptionGroups?limit=200`);
    for (const found of groups?.data ?? []) {
      rows.push(...(await listGroupSubscriptions(session, { id: found.id, referenceName: attribute(found, "referenceName") })));
    }
  } else {
    throw new UsageError("Pass the App Store app (asc subscriptions list <id|bundle id>), or --group <id>.");
  }
  return { rows: subscriptionRows(rows), data: rows, noun: "subscription" };
}

export async function runSubscriptionsGet(session: AscSession, input: AscInput): Promise<AscOutput> {
  return { value: await findSubscription(session, argOf(input, "id")) };
}

function subscriptionAttributes(input: AscInput): Record<string, unknown> {
  return compact({
    name: textOf(input, "name"),
    subscriptionPeriod: textOf(input, "subscriptionPeriod"),
    familySharable: booleanOf(input, "familySharable"),
    reviewNote: textOf(input, "reviewNote"),
    groupLevel: numberOf(input, "groupLevel"),
  });
}

function freeTrialEntries(subscription: string, territories: readonly string[], trial: string | undefined): Record<string, unknown>[] {
  if (!trial) return [];
  return introductoryOfferEntries(subscription, territories, { duration: trial, offerMode: "FREE_TRIAL", numberOfPeriods: 1 });
}

async function firstSubscriptionOf(session: AscSession, group: string): Promise<string | undefined> {
  const document = await session.get(`/v1/subscriptionGroups/${group}/subscriptions?limit=1&fields[subscriptions]=productId`);
  return document?.data[0]?.id;
}

async function findReferenceSubscription(session: AscSession, groupId: string, ascApp: string | undefined): Promise<string | undefined> {
  const inGroup = await firstSubscriptionOf(session, groupId);
  if (inGroup || !ascApp) return inGroup;
  const app = await resolveAscAppId(session, ascApp);
  const groups = await session.list(`/v1/apps/${app}/subscriptionGroups?limit=200`);
  for (const group of groups?.data ?? []) {
    if (group.id === groupId) continue;
    const found = await firstSubscriptionOf(session, group.id);
    if (found) return found;
  }
  return undefined;
}

export async function runSubscriptionsCreate(session: AscSession, input: AscInput): Promise<AscOutput> {
  const ascApp = textOf(input, "ascApp");
  const groupId = await resolveGroupId(session, requireText(input, "group"), ascApp);
  const productId = requireText(input, "productId");
  const price = requireNumber(input, "price");
  const territory = textOf(input, "territory") ?? DEFAULT_TERRITORY;
  const reference = await findReferenceSubscription(session, groupId, ascApp);
  if (reference) await findPricePoint(session, "subscription", reference, territory, price);
  const subscription = await session.send(
    "post",
    "/v1/subscriptions",
    {
      data: {
        type: "subscriptions",
        attributes: { productId, ...subscriptionAttributes(input) },
        relationships: { group: linkTo("subscriptionGroups", groupId) },
      },
    },
    "subscription",
  );
  if (!subscription) throw new Error("Apple created no subscription.");
  const made: CreatedSubscription = { id: subscription.id, productId, price, territory, priceFound: false };
  try {
    return await finishSubscription(session, input, made);
  } catch (error) {
    throw unfinishedError(error, input, made);
  }
}

interface CreatedSubscription {
  id: string;
  productId: string;
  price: number;
  territory: string;
  priceFound: boolean;
}

function quoted(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function scopeFlags(input: AscInput): string {
  const scope = input.scope ?? {};
  return [
    ...(scope.app ? [` --app ${quoted(scope.app)}`] : []),
    ...(scope.project ? [` --project ${quoted(scope.project)}`] : []),
    ...(scope.team ? [` --team ${quoted(scope.team)}`] : []),
  ].join("");
}

function availabilityCommand(input: AscInput, target: string): string {
  const newTerritories = booleanOf(input, "availableInNewTerritories");
  const choice = newTerritories === undefined ? "" : ` --available-in-new-territories=${newTerritories}`;
  return `asc availability set ${target} --available-territories ${textOf(input, "availableTerritories") ?? "all"}${choice}`;
}

function priceCommands(made: CreatedSubscription, target: string): string[] {
  if (made.priceFound) return [`asc prices set ${target} --price ${made.price} --territory ${made.territory}`];
  return [`asc prices points ${target} --territory ${made.territory}`, `asc prices set ${target} --price <price> --territory ${made.territory}`];
}

function finishingCommands(input: AscInput, made: CreatedSubscription): string[] {
  const target = `--subscription ${made.id}`;
  const displayName = textOf(input, "displayName");
  const description = textOf(input, "description");
  const trial = textOf(input, "trial");
  const scope = scopeFlags(input);
  return [
    ...(displayName
      ? [`asc localizations add ${target} --locale ${textOf(input, "locale") ?? DEFAULT_LOCALE} --name ${quoted(displayName)}${description ? ` --description ${quoted(description)}` : ""}`]
      : []),
    availabilityCommand(input, target),
    ...priceCommands(made, target),
    ...(trial ? [`asc offers create ${target} --offer-mode FREE_TRIAL --duration ${trial}`] : []),
  ].map((command) => `${command}${scope}`);
}

function unfinishedError(error: unknown, input: AscInput, made: CreatedSubscription): Error {
  const reason = (error instanceof Error ? error.message : String(error)).split("\n").filter((line) => !line.startsWith("Already created:"));
  const message = [
    ...reason,
    `Already created: subscriptions ${made.id} (${made.productId}).`,
    "Apple keeps a product ID once used, so running create again fails. Finish this subscription with what is still missing:",
    ...finishingCommands(input, made).map((command) => `  superwall ${command}`),
    ...(made.priceFound ? [] : [`${made.price} is not a ${made.territory} price, so pick one from asc prices points for <price>.`]),
  ].join("\n");
  const status = statusOf(error);
  return status === undefined ? new Error(message) : new AscRequestError(message, status);
}

async function finishSubscription(session: AscSession, input: AscInput, made: CreatedSubscription): Promise<AscOutput> {
  const { id, productId, territory } = made;
  const point = await findPricePoint(session, "subscription", id, territory, made.price);
  made.priceFound = true;

  const displayName = textOf(input, "displayName");
  if (displayName) {
    const version = await resolveDraftVersion(session, "subscription", id);
    const description = textOf(input, "description");
    await createLocalization(session, "subscription", version, {
      locale: textOf(input, "locale") ?? DEFAULT_LOCALE,
      name: displayName,
      ...(description ? { description } : {}),
    });
  }

  const available = textOf(input, "availableTerritories") ?? "all";
  const territories = await resolveTerritories(session, available);
  const newTerritories = booleanOf(input, "availableInNewTerritories") ?? available.toLowerCase() === "all";
  await upsertAvailability(session, "subscription", id, territories, newTerritories, undefined);
  const { points, skipped } = await resolveTerritoryPoints(session, { territory, point }, territories);
  await session.send(
    "patch",
    `/v1/subscriptions/${id}`,
    bulkSubscriptionPatch(id, {
      prices: subscriptionPriceEntries(points, {}),
      offers: freeTrialEntries(id, [...points.keys()], textOf(input, "trial")),
    }),
  );

  if (session.dryRun) return { value: undefined };
  const view = await findSubscription(session, id);
  const still = view.missing.length ? `; still missing: ${view.missing.join(", ")}` : "";
  return {
    value: { ...view, ...(skipped.length ? { skippedTerritories: skipped } : {}) },
    heading: `Created ${productId} (${view.state ?? "state unknown"})${still}`,
  };
}

export async function runSubscriptionsUpdate(session: AscSession, input: AscInput): Promise<AscOutput> {
  const id = argOf(input, "id");
  const attributes = subscriptionAttributes(input);
  if (Object.keys(attributes).length === 0) {
    throw new UsageError("Nothing to change: pass --name, --subscription-period, --family-sharable, --review-note or --group-level.");
  }
  await session.send("patch", `/v1/subscriptions/${id}`, { data: { type: "subscriptions", id, attributes } });
  return { value: { id, ...attributes }, heading: `Updated subscription ${id}` };
}

export async function runSubscriptionsDelete(session: AscSession, input: AscInput): Promise<AscOutput> {
  const id = argOf(input, "id");
  await assertConfirmed(session, input.yes, `Delete subscription ${id}`);
  await session.send("delete", `/v1/subscriptions/${id}`);
  return { value: { id, deleted: true }, heading: `Deleted subscription ${id}` };
}
