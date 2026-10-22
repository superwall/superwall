import { attribute, linkTo } from "./json-api";
import { createLocalization, listVersionLocalizations, type LocalizationView } from "./localizations";
import { argOf, requireText, textOf, type AscInput, type AscOutput } from "./operation";
import { assertConfirmed, type AscSession } from "./session";
import { selectLatestVersion, resolveAscAppId, type VersionView } from "./targets";

const DEFAULT_LOCALE = "en-US";

export interface GroupView {
  id: string;
  referenceName?: string;
  version?: VersionView;
  localizations: LocalizationView[];
  subscriptions: { id: string; productId?: string; name?: string; state?: string }[];
  missing: string[];
}

async function findSubscriptionGroup(session: AscSession, id: string): Promise<GroupView> {
  const document = await session.get(`/v1/subscriptionGroups/${id}`);
  const group = document?.one;
  if (!group) throw new Error(`No subscription group ${id}.`);
  const version = await selectLatestVersion(session, "group", id);
  const localizations = await listVersionLocalizations(session, "group", version?.id);
  const subscriptions = await session.list(`/v1/subscriptionGroups/${id}/subscriptions?limit=200`);
  return {
    id,
    referenceName: attribute(group, "referenceName"),
    ...(version ? { version } : {}),
    localizations,
    subscriptions: (subscriptions?.data ?? []).map((subscription) => ({
      id: subscription.id,
      productId: attribute(subscription, "productId"),
      name: attribute(subscription, "name"),
      state: attribute(subscription, "state"),
    })),
    missing: localizations.length ? [] : ["localization"],
  };
}

export async function runSubscriptionGroupsList(session: AscSession, input: AscInput): Promise<AscOutput> {
  const app = await resolveAscAppId(session, argOf(input, "asc-app"));
  const document = await session.list(`/v1/apps/${app}/subscriptionGroups?limit=200`);
  const groups = (document?.data ?? []).map((group) => ({ id: group.id, referenceName: attribute(group, "referenceName") }));
  return { rows: groups.map((group) => ({ label: group.referenceName ?? group.id, meta: group.id })), data: groups, noun: "subscription group" };
}

export async function runSubscriptionGroupsGet(session: AscSession, input: AscInput): Promise<AscOutput> {
  return { value: await findSubscriptionGroup(session, argOf(input, "id")) };
}

export async function runSubscriptionGroupsCreate(session: AscSession, input: AscInput): Promise<AscOutput> {
  const app = await resolveAscAppId(session, requireText(input, "ascApp"));
  const referenceName = requireText(input, "referenceName");
  const displayName = textOf(input, "displayName");
  const group = await session.send(
    "post",
    "/v1/subscriptionGroups",
    { data: { type: "subscriptionGroups", attributes: { referenceName }, relationships: { app: linkTo("apps", app) } } },
    "group",
  );
  if (!group) throw new Error("Apple created no subscription group.");
  if (displayName) {
    const version = await selectLatestVersion(session, "group", group.id);
    if (!version) throw new Error(`Apple made no version of subscription group ${group.id} to localize.`);
    const customAppName = textOf(input, "customAppName");
    await createLocalization(session, "group", version.id, {
      locale: textOf(input, "locale") ?? DEFAULT_LOCALE,
      name: displayName,
      ...(customAppName ? { customAppName } : {}),
    });
  }
  if (session.dryRun) return { value: undefined };
  return { value: await findSubscriptionGroup(session, group.id), heading: `Created the subscription group ${referenceName}` };
}

export async function runSubscriptionGroupsUpdate(session: AscSession, input: AscInput): Promise<AscOutput> {
  const id = argOf(input, "id");
  const referenceName = requireText(input, "referenceName");
  const updated = await session.send("patch", `/v1/subscriptionGroups/${id}`, {
    data: { type: "subscriptionGroups", id, attributes: { referenceName } },
  });
  return { value: { id, referenceName: updated ? attribute(updated, "referenceName") : referenceName }, heading: `Renamed subscription group ${id}` };
}

export async function runSubscriptionGroupsDelete(session: AscSession, input: AscInput): Promise<AscOutput> {
  const id = argOf(input, "id");
  await assertConfirmed(session, input.yes, `Delete subscription group ${id}`);
  await session.send("delete", `/v1/subscriptionGroups/${id}`);
  return { value: { id, deleted: true }, heading: `Deleted subscription group ${id}` };
}
