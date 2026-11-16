import type { Policy, Rule } from "./text";

// Who wrote the strings a tool returns, so a result can say so (./text.ts).
//
// Nothing here grants trust by leaving a field out: a string no rule names is
// `unknown` and is marked like any other. A rule only sharpens the label (an end
// user, the customer, another service) or says a value must stay exact because it
// is the argument to the next call. The one way text reaches an agent unmarked is
// `OURS`, and `policyFor` gives that to two tools.
//
// The field names are the public API's. A field the API adds is `unknown` until it
// is named here.

/** A value an agent passes back to a tool: nothing in it may change. */
const exact = (author: Rule["author"], ...paths: string[]): Rule[] => paths.map((path) => ({ path, author, exact: true }));
const text = (author: Rule["author"], ...paths: string[]): Rule[] => paths.map((path) => ({ path, author }));

const ACCOUNT_RULES: Rule[] = [
  // What an app's users, or the SDK on their device, sent. Anyone with the app can write these.
  ...text("end_user", "**.attributes.**", "**.user_attributes.**", "**.params.**"),
  ...exact(
    "end_user",
    "**.app_user_id",
    "**.user_id",
    "**.application_user_id",
    "**.application_user_alias_id",
    "**.original_customer_id",
    "**.customer_id",
    "**.device_id",
    "**.aliases",
    "**.event_name",
  ),
  // What another service answered: a webhook endpoint's response, the store's text.
  ...text("third_party", "**.response.**", "**.response_body", "**.app_store_info.**"),
  // What someone with access to this account wrote.
  ...exact("customer", "**.identifier", "**.entitlement_identifier", "**.lookup_key", "**.slug", "**.bundle_id", "**.url"),
  ...text(
    "customer",
    "**.name",
    "**.display_name",
    "**.title",
    "**.subtitle",
    "**.description",
    "**.notes",
    "**.label",
    "**.reference_name",
    "**.subscription_group_name",
    "**.page_name",
    "**.metadata.**",
    "**.headers.**",
  ),
];

/** The Superwall API's own resources: apps, products, campaigns, paywalls, users, webhooks. */
export const ACCOUNT: Policy = { default: "unknown", rules: ACCOUNT_RULES };

/** `query` rows: any column can hold anything an app sent. */
export const ROWS: Policy = { default: "unknown" };

/** App Store Connect and Apple Search Ads, answered by Apple: names, review notes, search terms, Apple's docs. */
export const APPLE: Policy = { default: "third_party" };

/**
 * `feedback` answers with the request the report joined. Its title was written by a
 * model from other customers' reports, so it is theirs as much as anyone's.
 */
export const FEEDBACK: Policy = { default: "unknown", rules: [{ path: "request.title", author: "agent" }, ...ACCOUNT_RULES] };

/** Text Superwall wrote and ships: the skills, and the API reference. Read as ours. */
export const OURS: Policy = { default: "superwall" };

/** The tools whose text is ours. Adding one says an agent may read that tool's text as instructions. */
export const OUR_TOOLS: readonly string[] = ["skill", "api_docs"];

export function policyFor(tool: string): Policy {
  if (OUR_TOOLS.includes(tool)) return OURS;
  if (tool.startsWith("asc_") || tool.startsWith("asa_")) return APPLE;
  if (tool === "query") return ROWS;
  if (tool === "feedback") return FEEDBACK;
  return ACCOUNT;
}
