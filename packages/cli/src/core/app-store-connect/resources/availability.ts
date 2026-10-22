import { attribute, linkTo, linkToMany, type AscResource } from "./json-api";
import { booleanOf, plural, requireText, type AscInput, type AscOutput } from "./operation";
import type { PricedKind } from "./pricing";
import { isPlaceholder, type AscSession } from "./session";
import { KINDS, resolveTarget, resolveTerritories } from "./targets";

export interface AvailabilityView {
  id: string;
  planType?: string;
  availableInNewTerritories: boolean;
  territories: string[];
}

const PRICED: readonly PricedKind[] = ["subscription", "iap"];

const AVAILABILITY = {
  subscription: {
    of: (id: string) => `/v1/subscriptions/${id}/planAvailabilities?limit=50`,
    territories: (id: string) => `/v1/subscriptionPlanAvailabilities/${id}/availableTerritories?limit=200`,
    path: "/v1/subscriptionPlanAvailabilities",
    type: "subscriptionPlanAvailabilities",
  },
  iap: {
    of: (id: string) => `/v2/inAppPurchases/${id}/inAppPurchaseAvailability`,
    territories: (id: string) => `/v1/inAppPurchaseAvailabilities/${id}/availableTerritories?limit=200`,
    path: "/v1/inAppPurchaseAvailabilities",
    type: "inAppPurchaseAvailabilities",
  },
} as const;

async function selectUpfrontPlan(session: AscSession, path: string): Promise<AscResource | undefined> {
  const document = await session.get(path);
  return document?.data.find((plan) => attribute(plan, "planType") !== "MONTHLY");
}

export async function selectAvailability(session: AscSession, kind: PricedKind, id: string): Promise<AvailabilityView | undefined> {
  const spec = AVAILABILITY[kind];
  if (isPlaceholder(id)) {
    await session.get(spec.of(id));
    return undefined;
  }
  const reading = kind === "subscription" ? selectUpfrontPlan(session, spec.of(id)) : session.select(spec.of(id));
  const found = await reading;
  if (!found) return undefined;
  const territories = await session.list(spec.territories(found.id));
  const planType = attribute(found, "planType");
  return {
    id: found.id,
    ...(planType ? { planType } : {}),
    availableInNewTerritories: found.attributes.availableInNewTerritories === true,
    territories: (territories?.data ?? []).map((territory) => territory.id),
  };
}

export async function upsertAvailability(
  session: AscSession,
  kind: PricedKind,
  id: string,
  territories: readonly string[],
  availableInNewTerritories: boolean,
  existing: AvailabilityView | undefined,
): Promise<void> {
  const spec = AVAILABILITY[kind];
  const availableTerritories = linkToMany("territories", territories);
  if (kind === "subscription" && existing) {
    await session.send("patch", `${spec.path}/${existing.id}`, {
      data: { type: spec.type, id: existing.id, attributes: { availableInNewTerritories }, relationships: { availableTerritories } },
    });
    return;
  }
  const owner = kind === "subscription" ? { subscription: linkTo("subscriptions", id) } : { inAppPurchase: linkTo("inAppPurchases", id) };
  const attributes = kind === "subscription" ? { planType: "UPFRONT", availableInNewTerritories } : { availableInNewTerritories };
  await session.send("post", spec.path, { data: { type: spec.type, attributes, relationships: { ...owner, availableTerritories } } }, "availability");
}

export async function runAvailabilityGet(session: AscSession, input: AscInput): Promise<AscOutput> {
  const { kind, id } = resolveTarget(input, PRICED);
  const view = await selectAvailability(session, kind, id);
  if (!view) return { value: { available: false, territories: [] }, heading: `The ${KINDS[kind].noun} ${id} isn't available in any territory yet` };
  return { value: view };
}

export async function runAvailabilitySet(session: AscSession, input: AscInput): Promise<AscOutput> {
  const { kind, id } = resolveTarget(input, PRICED);
  const value = requireText(input, "availableTerritories");
  const territories = await resolveTerritories(session, value);
  const newTerritories = booleanOf(input, "availableInNewTerritories") ?? value.toLowerCase() === "all";
  const existing = await selectAvailability(session, kind, id);
  await upsertAvailability(session, kind, id, territories, newTerritories, existing);
  if (session.dryRun) return { value: undefined };
  return { value: await selectAvailability(session, kind, id), heading: `Available in ${plural(territories.length, "territory")}` };
}
