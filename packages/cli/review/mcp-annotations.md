# MCP annotation review — 2026-10-29

This source change corrects effect metadata and descriptions. It preserves every tool, argument schema, handler, generic executor and fallback instruction. It does not release the CLI, update a consumer pin, deploy, appeal or resubmit the plugin.

## Catalog and policy

The supplied published-2.1.0 audit covered 209 tools. A clean build of canonical `main` at `97131aa45adbfbc1d44f5747742e42ab203862ee` exposes **214**, including five `annotations_*` tools absent from that audited bundle. All 214 are preserved. `annotations_update` overwrites existing chart metadata and is included in the correction. This does not assert which catalog is deployed.

The rejection did not identify offending tools. Destructive-hint mismatches remain an evidence-based explanation, not a reviewer-confirmed diagnosis. The [annotation guidelines](https://developers.openai.com/plugins/plugin-guidelines#correct-annotation) require explicit booleans, treat overwrites and irreversible sends as destructive, and distinguish public/arbitrary destinations from externally hosted private accounts. They currently waive justifications; the rejection requests them, so behavior rationales follow below without adding unsupported MCP fields.

All four hints are explicit booleans. Reads use idempotent=true (changing results do not imply changing side effects); writes retain idempotent=false unless a stronger guarantee is established. The independently reviewed expectation fixture is `tests/fixtures/mcp-annotations.json`; it was assembled from the audit plus the decisions below, rather than generated from the new classifier.

Main resource operations and every Apple Ads endpoint now declare their effects. Multi-endpoint tools take destructive if any branch is destructive, read only if every branch is read, and write otherwise. CLI confirmation behavior is preserved separately from MCP effect metadata.

## Conditional investigations

| Case | Decision and evidence |
| --- | --- |
| `campaigns_audiences_create` | Keep nondestructive: `CampaignRepository.createAudience` appends with `nextRankAfter(existing)` and does not overwrite existing audiences. It is enabled by default and can serve previously unmatched traffic; description discloses this. |
| `campaigns_audiences_duplicate` | Destructive: the clone starts **paused**, contrary to the audit's tentative enabled-clone assumption. However, dirty/duplicate legacy ranks call `reorderAudiences`, rewriting existing audience ranks. Description covers that branch. |
| `asc_offers_create` | Destructive: CLI `createIntroductoryOffer` patches the subscription's introductory-offer relationship. [Apple's offer guide](https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-up-introductory-offers-for-auto-renewable-subscriptions/) explicitly says new offers with overlapping dates overwrite existing ones. |
| `asa_campaigns_create` | Destructive: accepts ENABLED and a daily budget, with no paused-draft constraint. [Create a Campaign](https://developer.apple.com/documentation/apple_ads/create-a-campaign) describes advertising campaigns; actual serving depends on eligibility, dates and ad groups. Does not claim the call always charges immediately. |
| `asa_adgroups_create` | Destructive: accepts enabled bid-bearing groups in live campaigns. [Apple's example](https://developer.apple.com/documentation/apple_ads/create-an-ad-group) returns RUNNING for a newly created enabled automated group. |
| `asa_keywords_create` | Destructive: [Apple's endpoint](https://developer.apple.com/documentation/apple_ads/create-targeting-keywords) creates ACTIVE bidding keywords; adding them to eligible live groups can enable spending. |
| `asa_ads_create` | Destructive: [Apple's creation example](https://developer.apple.com/documentation/apple_ads/create-an-ad) returns ENABLED/RUNNING. It is not constrained to paused drafts. |
| `asa_budget_orders_create` | Destructive: [Apple's creation example](https://developer.apple.com/documentation/apple_ads/create-a-budget-order) returns ACTIVE financial orders with budgets, buyer and billing information. Treat potential financial effects conservatively; invoice timing and exact contractual liability were not runtime-verified. |
| `query` | Not read-only and destructive: SQL is forced to readonly=1, but `ClickhouseProxyService.getCredentials` creates a user/role and persists sealed credentials on first use; existing credentials call `verifyPolicies`, which reconciles access policies. This is environment mutation and possible replacement of access configuration, not merely a cache. `get` also exposes the same GET query route and receives the same classification. No backend code changed. |

Backend evidence was the supplied source snapshot at paywall-next `01eb0cd99f983bcdef490e40832031493deade15`: `packages/api/src/v2/repository/campaigns/CampaignRepository.ts`, `packages/api/src/v2/services/ClickhouseProxyService.ts`, `packages/clickhouse-customers/src/queryRequest.ts`, and the supplied webhook, entitlement, key-copy and user-attribute source files. CLI implementation was checked on the fetched canonical main revision above. These are static checks; no spend, delivery, live traffic or production SQL calls were performed.

## Boundaries and remaining follow-up

- `entitlements_grants_create` remains additive: promotional access without a charge; existing active grants are rejected. POST selector/report lookups remain reads; `asa_impression_share_create` remains a write because it requests a persisted report job.
- `post` and `patch` are open-world because arbitrary webhook destinations are reachable. `webhooks_create`, `webhooks_update` and `events_retry` retain open-world hints for caller-chosen/configured destinations. Fixed-recipient feedback stays closed-world despite its irreversible send.
- Apple-family openWorld=true values are retained conservatively. Public App Store/geography lookup tools clearly cross a public-catalog boundary. Some private Apple account operations could support false; external hosting alone is not justification for true. A precise operation-by-operation tightening is deferred, rather than inventing a new boundary in this patch.
- `query` and generic `get` retain openWorld=false for the intended organization-scoped analytics boundary. Deployed ClickHouse table-function privileges and network egress were not established by this static evidence. Backend follow-up must verify those controls; readonly=1 alone does not prove an absence of arbitrary network access. Preprovisioning and policy reconciliation should be separated if these tools are to advertise read-only semantics later.
- The [generic operation exposure requirement](https://developers.openai.com/plugins/plugin-guidelines#tool-independence-and-exposure) remains unresolved and deliberately deferred by the user. All 15 generic tools and fallback instructions stay available. This annotation PR does not establish full plugin compliance or guarantee approval.
- After separately authorized merge/release: release `@superwall/cli`, update the consumer pin, deploy the MCP consumer, capture authenticated production tools/list, compare names/schemas/descriptions/hints, then rescan and inspect held/live definitions per the [submission guide](https://developers.openai.com/plugins/deploy/submission#find-and-resolve-tool-issues). Appeal/resubmission requires separate authorization.

## Verification

- Full repository `bun run build`, `bun run typecheck`, `bun run lint`, `bun run format`, `bun run format:check` and `bun run test:coverage` completed successfully. Lint reports pre-existing warnings outside the CLI, which is excluded by repository configuration.
- CLI coverage: 2,045 tests passed; 99.19% lines, 95.69% branches, 97.59% functions. Thresholds were not lowered. The standalone-bundle subprocess clears Node's inherited test/coverage context so the already-covered source is not counted a second time as generated code; it still executes and checks all 214 bundled definitions.
- A clean before/after bundle comparison verified identical tool names, ordering and input schemas, all 15 generic tools and fallback instructions. `mcp-catalog-parity.json` records the equal schema digests and all 51 changed hint sets (48 destructive corrections and three read-only POST corrections).
- The real built CLI's `get --help` path prints the provisioning caveat. No authenticated production mutation, advertising spend, delivery, release or deployment was used for validation.

## Companion edits (prepared, not published)

`companion-docs.patch` updates `content/docs/agents/mcp.mdx`: removes a stale fixed tool count, corrects the permissions examples and describes overwrites, outbound sends and analytics setup effects. `companion-skills.patch` updates `skills/superwall/SKILL.md` and `skills/superwall/references/api.md` with the same boundaries. Both patches were prepared against fresh isolated main checkouts and pass `git diff --check`. They remain separate review artifacts, not deployed documentation or released skills. Companion full build/test gates must run in those repositories before publishing; the canonical CLI checks do not validate them.

## Per-tool rationale

`R/D/I/O` are read-only/destructive/idempotent/open-world booleans. Each behavior row explains R and D. I follows the side-effect rule above. O uses these boundary codes: **account** = bounded Superwall account or bundled reference; **destination** = arbitrary/configured HTTPS delivery; **Apple** = retained conservative Apple-family boundary, with the qualification above; **feedback** = fixed Superwall team recipient. `false` on feedback does not mean it is reversible. All values are metadata claims based on static evidence, not runtime certification.

| Tool | R | D | I | O | Behavior rationale | Boundary |
| --- | --- | --- | --- | --- | --- | --- |
| `skill` | true | false | true | false | Retrieves or computes: Superwall's skills: guides for agents. superwall/SKILL.md says how the account, SDK, campaigns, analytics and App Store Connect fit together; read it before other work, then the reference, workflow or other skill it points to.. No persisted job or customer-state write identified. | account |
| `bootstrap` | true | false | true | false | Retrieves or computes: Everything at once: projects, apps, campaigns, products. No persisted job or customer-state write identified. | account |
| `apps_list` | true | false | true | false | Retrieves or computes: Every app, by organization and project. No persisted job or customer-state write identified. | account |
| `apps_get` | true | false | true | false | Retrieves or computes: Everything about one app: bundle ID, Apple team, keys, URLs. No persisted job or customer-state write identified. | account |
| `apps_create` | false | false | false | false | Adds state: Add an app to a project. No existing-resource overwrite or irreversible transaction identified in the reviewed path. | account |
| `apps_update` | false | true | false | false | Overwrites app settings, including routing, revenue provider and bundle ID. Changing the bundle ID can put deployed builds into test mode. | account |
| `apps_statistics` | true | false | true | false | Retrieves or computes: Users, revenue and conversion, as the dashboard's overview shows them. No persisted job or customer-state write identified. | account |
| `apps_transactions` | true | false | true | false | Retrieves or computes: Its most recent transactions, as the dashboard lists them. No persisted job or customer-state write identified. | account |
| `apps_notices` | true | false | true | false | Retrieves or computes: What the dashboard warns about on its overview. No persisted job or customer-state write identified. | account |
| `products_list` | true | false | true | false | Retrieves or computes: Products of a project. No persisted job or customer-state write identified. | account |
| `products_get` | true | false | true | false | Retrieves or computes: One product. No persisted job or customer-state write identified. | account |
| `products_create` | false | false | false | false | Adds state: Create a product. No existing-resource overwrite or irreversible transaction identified in the reviewed path. | account |
| `products_update` | false | true | false | false | Changes existing state: Change a product. Deletion, replacement, revocation or distribution may affect existing resources. | account |
| `products_delete` | false | true | false | false | Changes existing state: Delete a product. Deletion, replacement, revocation or distribution may affect existing resources. | account |
| `products_impact` | true | false | true | false | Retrieves or computes: What deleting it would break. No persisted job or customer-state write identified. | account |
| `entitlements_list` | true | false | true | false | Retrieves or computes: Entitlements of a project. No persisted job or customer-state write identified. | account |
| `entitlements_get` | true | false | true | false | Retrieves or computes: One entitlement. No persisted job or customer-state write identified. | account |
| `entitlements_create` | false | false | false | false | Adds state: Create an entitlement. No existing-resource overwrite or irreversible transaction identified in the reviewed path. | account |
| `entitlements_update` | false | true | false | false | Can rename the SDK entitlement identifier and replace its product associations, in addition to overwriting text and metadata. | account |
| `entitlements_delete` | false | true | false | false | Changes existing state: Delete an entitlement. Deletion, replacement, revocation or distribution may affect existing resources. | account |
| `entitlements_grants_list` | true | false | true | false | Retrieves or computes: Grants of an entitlement. No persisted job or customer-state write identified. | account |
| `entitlements_grants_create` | false | false | false | false | Adds promotional access without purchase; rejects an active existing grant. | account |
| `entitlements_grants_delete` | false | true | false | false | Changes existing state: Take a grant back. Deletion, replacement, revocation or distribution may affect existing resources. | account |
| `campaigns_list` | true | false | true | false | Retrieves or computes: Campaigns of an app. No persisted job or customer-state write identified. | account |
| `campaigns_get` | true | false | true | false | Retrieves or computes: One campaign with its audiences and placements. No persisted job or customer-state write identified. | account |
| `campaigns_create` | false | false | false | false | Adds state: Create a campaign that a placement triggers. No existing-resource overwrite or irreversible transaction identified in the reviewed path. | account |
| `campaigns_update` | false | true | false | false | Overwrites supplied campaign fields, including description, notes and delivery mode. | account |
| `campaigns_archive` | false | true | false | false | Changes existing state: Archive it. Deletion, replacement, revocation or distribution may affect existing resources. | account |
| `campaigns_unarchive` | false | false | false | false | Adds state: Bring it back. No existing-resource overwrite or irreversible transaction identified in the reviewed path. | account |
| `campaigns_prioritize` | false | true | false | false | Enabling priority clears priority on other campaigns in the app before prioritizing this campaign. | account |
| `campaigns_counts` | true | false | true | false | Retrieves or computes: How many users each audience assigned. No persisted job or customer-state write identified. | account |
| `campaigns_placements_create` | false | true | false | false | Changes existing state: Trigger it on an event. Deletion, replacement, revocation or distribution may affect existing resources. | account |
| `campaigns_placements_update` | false | true | false | false | Changes event name, enabled state or delivery mode and refreshes live configuration. Can stop or redirect an existing trigger. | account |
| `campaigns_placements_delete` | false | true | false | false | Changes existing state: Stop triggering it on an event. Deletion, replacement, revocation or distribution may affect existing resources. | account |
| `campaigns_audiences_create` | false | false | false | false | Appends an audience after existing audiences. It is enabled unless disabled explicitly; existing audience precedence is preserved. | account |
| `campaigns_audiences_update` | false | true | false | false | Changes existing state: Change its rules or name. Deletion, replacement, revocation or distribution may affect existing resources. | account |
| `campaigns_audiences_delete` | false | true | false | false | Changes existing state: Remove an audience. Deletion, replacement, revocation or distribution may affect existing resources. | account |
| `campaigns_audiences_duplicate` | false | true | false | false | Copies the audience and variants into a paused audience immediately after the source. Legacy or duplicate ranks can trigger a rewrite of existing audience ranks. | account |
| `campaigns_audiences_reorder` | false | true | false | false | Replaces matching precedence for existing audiences; existing users may match a different audience. | account |
| `campaigns_audiences_reset` | false | true | false | false | Changes existing state: Forget who was assigned to it. Deletion, replacement, revocation or distribution may affect existing resources. | account |
| `campaigns_audiences_readout` | true | false | true | false | Retrieves or computes: How its variants are doing: conversion and revenue per variant. No persisted job or customer-state write identified. | account |
| `campaigns_audiences_users` | true | false | true | false | Retrieves or computes: Users it matched. No persisted job or customer-state write identified. | account |
| `campaigns_audiences_purchasers` | true | false | true | false | Retrieves or computes: Users who bought after seeing it. No persisted job or customer-state write identified. | account |
| `campaigns_variants_create` | false | true | false | false | Adding the first treatment without a percentage gives it 100% and zeroes existing variant weights, including the holdout. This can change live traffic. | account |
| `campaigns_variants_update` | false | true | false | false | Changes existing state: Change its paywall. Deletion, replacement, revocation or distribution may affect existing resources. | account |
| `campaigns_variants_delete` | false | true | false | false | Changes existing state: Remove a variant. Deletion, replacement, revocation or distribution may affect existing resources. | account |
| `campaigns_variants_weights` | false | true | false | false | Overwrites allocation percentages for existing variants and changes live traffic distribution. | account |
| `paywalls_list` | true | false | true | false | Retrieves or computes: Paywalls of an app. No persisted job or customer-state write identified. | account |
| `paywalls_get` | true | false | true | false | Retrieves or computes: One paywall. No persisted job or customer-state write identified. | account |
| `paywalls_create` | false | false | false | false | Adds state: Create a paywall. No existing-resource overwrite or irreversible transaction identified in the reviewed path. | account |
| `paywalls_duplicate` | false | false | false | false | Adds state: Copy a paywall. No existing-resource overwrite or irreversible transaction identified in the reviewed path. | account |
| `paywalls_publish` | false | true | false | false | Changes existing state: Publish the latest saved draft of a paywall. Deletion, replacement, revocation or distribution may affect existing resources. | account |
| `paywalls_archive` | false | true | false | false | Changes existing state: Archive it. Deletion, replacement, revocation or distribution may affect existing resources. | account |
| `paywalls_unarchive` | false | false | false | false | Adds state: Bring it back. No existing-resource overwrite or irreversible transaction identified in the reviewed path. | account |
| `paywalls_versions` | true | false | true | false | Retrieves or computes: Versions pushed from code. No persisted job or customer-state write identified. | account |
| `users_get` | true | false | true | false | Retrieves or computes: Find a user by app user ID. No persisted job or customer-state write identified. | account |
| `users_subscriptions` | true | false | true | false | Retrieves or computes: Every subscription they have had, one row each. No persisted job or customer-state write identified. | account |
| `users_summary` | true | false | true | false | Retrieves or computes: One answer: are they paying, their status, spend, MRR and lifetime value. No persisted job or customer-state write identified. | account |
| `users_entitlements` | true | false | true | false | Retrieves or computes: What they have access to now. No persisted job or customer-state write identified. | account |
| `users_attributes` | true | false | true | false | Retrieves or computes: Attributes the SDK set on them. No persisted job or customer-state write identified. | account |
| `users_update` | false | true | false | false | Publishes attribute updates that replace user attribute values downstream and can change audience matching. Asynchronous persistence is still a write with overwrite effects. | account |
| `users_aliases` | true | false | true | false | Retrieves or computes: Their other IDs. No persisted job or customer-state write identified. | account |
| `users_events` | true | false | true | false | Retrieves or computes: What they did, newest first. No persisted job or customer-state write identified. | account |
| `webhooks_list` | true | false | true | false | Retrieves or computes: Webhook endpoints of a project. No persisted job or customer-state write identified. | account |
| `webhooks_get` | true | false | true | false | Retrieves or computes: One endpoint. No persisted job or customer-state write identified. | account |
| `webhooks_create` | false | false | false | true | Adds state: Add an endpoint. No existing-resource overwrite or irreversible transaction identified in the reviewed path. | destination |
| `webhooks_update` | false | true | false | true | Overwrites destination, filters, headers and disabled state; can stop or redirect existing event delivery. | destination |
| `webhooks_delete` | false | true | false | false | Changes existing state: Remove an endpoint. Deletion, replacement, revocation or distribution may affect existing resources. | account |
| `webhooks_rotate_secret` | false | true | false | false | Changes existing state: Issue a new signing secret. Deletion, replacement, revocation or distribution may affect existing resources. | account |
| `webhooks_attempts` | true | false | true | false | Retrieves or computes: Its delivery attempts. No persisted job or customer-state write identified. | account |
| `webhooks_stats` | true | false | true | false | Retrieves or computes: Its delivery statistics. No persisted job or customer-state write identified. | account |
| `events_list` | true | false | true | false | Retrieves or computes: Recent events. No persisted job or customer-state write identified. | account |
| `events_get` | true | false | true | false | Retrieves or computes: One event. No persisted job or customer-state write identified. | account |
| `events_attempts` | true | false | true | false | Retrieves or computes: Its delivery attempts. No persisted job or customer-state write identified. | account |
| `events_retry` | false | true | false | true | Resends an event to its configured webhook destination. Delivery cannot be recalled and may duplicate downstream processing. | destination |
| `annotations_list` | true | false | true | false | Retrieves or computes: Annotations of an app. No persisted job or customer-state write identified. | account |
| `annotations_get` | true | false | true | false | Retrieves or computes: One annotation. No persisted job or customer-state write identified. | account |
| `annotations_create` | false | false | false | false | Adds state: Mark a moment or a span on every chart of an app. No existing-resource overwrite or irreversible transaction identified in the reviewed path. | account |
| `annotations_update` | false | true | false | false | Overwrites supplied chart annotation fields. end_at=null turns a span into a point; description=null removes its existing description. | account |
| `annotations_delete` | false | true | false | false | Changes existing state: Delete an annotation. Deletion, replacement, revocation or distribution may affect existing resources. | account |
| `query` | false | true | false | false | The backend forces SQL to readonly=1. Before executing SQL it may provision a ClickHouse user and role, persist credentials and reconcile access policies for the organization. SQL read-only mode does not prevent these setup changes. | account |
| `api_docs` | true | false | true | false | Retrieves or computes: Every endpoint with its parameters and body. No persisted job or customer-state write identified. | account |
| `get` | false | true | false | false | Generic GET can reach the analytics endpoint, which provisions credentials and reconciles access policies before running SQL. | account |
| `post` | false | true | false | true | Executes an arbitrary Superwall POST endpoint. Depending on the path, it can archive, reset, publish, resend events or create a webhook to a caller-supplied HTTPS destination. Repeating a call may repeat its effects. | destination |
| `patch` | false | true | false | true | Executes an arbitrary Superwall PATCH endpoint. Depending on the path, it overwrites account configuration or redirects webhook delivery to a caller-supplied HTTPS destination. | destination |
| `delete` | false | true | false | false | Changes existing state: Make DELETE requests to the Superwall API. Deletion, replacement, revocation or distribution may affect existing resources. | account |
| `asc_keys_list` | true | false | true | true | Retrieves or computes: Which keys the app has; without --app, your organization's. No persisted job or customer-state write identified. | Apple |
| `asc_keys_delete` | false | true | false | true | Changes existing state: Remove the app's saved key; with a team id instead, your organization's. Deletion, replacement, revocation or distribution may affect existing resources. | Apple |
| `asc_keys_import` | false | true | false | true | Without from, fills missing keys from verified organization keys. With from, replaces the target app’s saved key. Creates no key at Apple; unconfirmed keys are saved only when allow_unconfirmed is explicitly requested. | Apple |
| `asc_keys_sources` | true | false | true | true | Retrieves or computes: Keys on your organization's other iOS apps that import could use. No persisted job or customer-state write identified. | Apple |
| `asc_notification_url_check` | true | false | true | true | Retrieves or computes: Ask Apple whose URL each environment has. No persisted job or customer-state write identified. | Apple |
| `asc_notification_url_set` | false | true | false | true | Fills empty Apple notification URLs and refuses to replace another server’s URL. set_revenue_provider also replaces the app’s revenue provider. | Apple |
| `asc_apps` | true | false | true | true | Retrieves or computes: Your apps in App Store Connect: name, bundle ID and id. No persisted job or customer-state write identified. | Apple |
| `asc_products` | true | false | true | true | Retrieves or computes: The products of one App Store app: subscriptions and in-app purchases. No persisted job or customer-state write identified. | Apple |
| `asc_subscription_groups_list` | true | false | true | true | Retrieves or computes: The app's subscription groups. No persisted job or customer-state write identified. | Apple |
| `asc_subscription_groups_get` | true | false | true | true | Retrieves or computes: One group: its version, localizations, subscriptions and what is missing. No persisted job or customer-state write identified. | Apple |
| `asc_subscription_groups_create` | false | false | false | true | Adds state: Create a group, and its first localization when --display-name is given. No existing-resource overwrite or irreversible transaction identified in the reviewed path. | Apple |
| `asc_subscription_groups_update` | false | true | false | true | PATCH replaces the existing group reference name. | Apple |
| `asc_subscription_groups_delete` | false | true | false | true | Changes existing state: Delete a group. Deletion, replacement, revocation or distribution may affect existing resources. | Apple |
| `asc_subscriptions_list` | true | false | true | true | Retrieves or computes: Subscriptions of every group of the app, or of one --group. No persisted job or customer-state write identified. | Apple |
| `asc_subscriptions_get` | true | false | true | true | Retrieves or computes: One subscription: localizations, prices, offers, availability, version state and what is missing. No persisted job or customer-state write identified. | Apple |
| `asc_subscriptions_create` | false | false | false | true | Adds state: Create a subscription with its localization, availability, prices and free trial. No existing-resource overwrite or irreversible transaction identified in the reviewed path. | Apple |
| `asc_subscriptions_update` | false | true | false | true | PATCH replaces subscription attributes, including period, group level and family-sharing configuration when accepted by Apple. | Apple |
| `asc_subscriptions_delete` | false | true | false | true | Changes existing state: Delete a subscription Apple has never reviewed. Deletion, replacement, revocation or distribution may affect existing resources. | Apple |
| `asc_iaps_list` | true | false | true | true | Retrieves or computes: The app's in-app purchases. No persisted job or customer-state write identified. | Apple |
| `asc_iaps_get` | true | false | true | true | Retrieves or computes: One in-app purchase: localizations, price schedule, availability, version state and what is missing. No persisted job or customer-state write identified. | Apple |
| `asc_iaps_create` | false | false | false | true | Adds state: Create an in-app purchase with its localization, availability and price. No existing-resource overwrite or irreversible transaction identified in the reviewed path. | Apple |
| `asc_iaps_update` | false | true | false | true | PATCH replaces existing IAP fields, including family-sharing configuration when accepted by Apple. | Apple |
| `asc_iaps_delete` | false | true | false | true | Changes existing state: Delete an in-app purchase. Deletion, replacement, revocation or distribution may affect existing resources. | Apple |
| `asc_localizations_list` | true | false | true | true | Retrieves or computes: Localizations of the latest version. No persisted job or customer-state write identified. | Apple |
| `asc_localizations_add` | false | false | false | true | Adds state: Add a localization. No existing-resource overwrite or irreversible transaction identified in the reviewed path. | Apple |
| `asc_localizations_update` | false | true | false | true | PATCH overwrites the existing localization. A missing draft can also be created by resolveDraftVersion. | Apple |
| `asc_localizations_delete` | false | true | false | true | Changes existing state: Delete the localization in --locale. Deletion, replacement, revocation or distribution may affect existing resources. | Apple |
| `asc_prices_points` | true | false | true | true | Retrieves or computes: Apple's price points in one territory, or the one at --price. No persisted job or customer-state write identified. | Apple |
| `asc_prices_list` | true | false | true | true | Retrieves or computes: Current and scheduled prices in every territory. No persisted job or customer-state write identified. | Apple |
| `asc_prices_set` | false | true | false | true | Replaces an IAP price schedule or updates subscription prices across available territories. Existing-subscriber price preservation is optional. | Apple |
| `asc_offers_list` | true | false | true | true | Retrieves or computes: A subscription's introductory offers, one per territory. No persisted job or customer-state write identified. | Apple |
| `asc_offers_create` | false | true | false | true | Creates introductory offers in the selected territories. New offers with overlapping dates overwrite existing introductory offers. | Apple |
| `asc_offers_update` | false | true | false | true | PATCH changes an existing introductory offer end date, potentially ending the offer earlier. | Apple |
| `asc_offers_delete` | false | true | false | true | Changes existing state: Delete one offer, or every offer of --subscription. Deletion, replacement, revocation or distribution may affect existing resources. | Apple |
| `asc_availability_get` | true | false | true | true | Retrieves or computes: The territories it is sold in. No persisted job or customer-state write identified. | Apple |
| `asc_availability_set` | false | true | false | true | Replaces the set of available territories and can remove existing sale availability. | Apple |
| `asc_submit` | false | true | false | true | Starts Apple review for products/groups and submits the review submission. This is an outbound workflow transition, not only creation of a local draft. | Apple |
| `asc_versions_list` | true | false | true | true | Retrieves or computes: The app's versions, newest first. No persisted job or customer-state write identified. | Apple |
| `asc_versions_get` | true | false | true | true | Retrieves or computes: One version: its build, localizations and phased release. No persisted job or customer-state write identified. | Apple |
| `asc_versions_create` | false | false | false | true | Adds state: Create a version. No existing-resource overwrite or irreversible transaction identified in the reviewed path. | Apple |
| `asc_versions_update` | false | true | false | true | PATCH overwrites version fields, release type and earliest release date; it can change automatic-release behavior. | Apple |
| `asc_versions_delete` | false | true | false | true | Changes existing state: Delete a version while it is still editable. Deletion, replacement, revocation or distribution may affect existing resources. | Apple |
| `asc_builds_list` | true | false | true | true | Retrieves or computes: The app's builds, newest upload first. No persisted job or customer-state write identified. | Apple |
| `asc_builds_get` | true | false | true | true | Retrieves or computes: One build: its version, processing state and the App Store version it is attached to. No persisted job or customer-state write identified. | Apple |
| `asc_builds_attach` | false | true | false | true | Changes existing state: Attach a build to an App Store version, replacing its current one. Deletion, replacement, revocation or distribution may affect existing resources. | Apple |
| `asc_builds_expire` | false | true | false | true | Changes existing state: Expire a build: no tester can install it and no version can use it. Deletion, replacement, revocation or distribution may affect existing resources. | Apple |
| `asc_metadata_list` | true | false | true | true | Retrieves or computes: The version's locales and which fields each has. No persisted job or customer-state write identified. | Apple |
| `asc_metadata_get` | true | false | true | true | Retrieves or computes: The version's text in one locale. No persisted job or customer-state write identified. | Apple |
| `asc_metadata_update` | false | true | false | true | PATCH overwrites existing App Store version localization text and URLs. | Apple |
| `asc_metadata_add` | false | false | false | true | Adds state: Add a locale to the version, with its text. No existing-resource overwrite or irreversible transaction identified in the reviewed path. | Apple |
| `asc_release_submit` | false | true | false | true | Adds the version and optional products to a review submission and sets submitted=true, changing the existing review workflow. | Apple |
| `asc_release_release` | false | true | false | true | Changes existing state: Release a version that is pending developer release. Deletion, replacement, revocation or distribution may affect existing resources. | Apple |
| `asc_release_phased` | false | true | false | true | Starts, pauses, resumes or completes phased distribution. Completing releases to all users; other actions replace rollout state, subject to Apple’s transition guards. | Apple |
| `asc_release_status` | true | false | true | true | Retrieves or computes: Where the version is: its state, build, review submission and phased release. No persisted job or customer-state write identified. | Apple |
| `asc_get` | true | false | true | true | Retrieves or computes: Any App Store Connect GET request, through the signed proxy. No persisted job or customer-state write identified. | Apple |
| `asc_post` | false | true | false | true | Executes an arbitrary App Store Connect POST through the signed proxy, after schema validation. It can submit reviews, release versions or replace price schedules; repeating a call may repeat its effects. | Apple |
| `asc_patch` | false | true | false | true | Executes an arbitrary App Store Connect PATCH through the signed proxy, after schema validation. It can overwrite attributes, relationships and distribution settings. | Apple |
| `asc_delete` | false | true | false | true | Changes existing state: Any App Store Connect DELETE request, through the signed proxy. Deletion, replacement, revocation or distribution may affect existing resources. | Apple |
| `asc_docs` | true | false | true | true | Retrieves or computes: Apple's exact request schema for an endpoint. No persisted job or customer-state write identified. | Apple |
| `asa_campaigns_list` | true | false | true | true | Retrieves or computes: List campaigns. No persisted job or customer-state write identified. | Apple |
| `asa_campaigns_get` | true | false | true | true | Retrieves or computes: Get a campaign. No persisted job or customer-state write identified. | Apple |
| `asa_campaigns_find` | true | false | true | true | Retrieves or computes: Find campaigns with a selector. No persisted job or customer-state write identified. | Apple |
| `asa_campaigns_create` | false | true | false | true | Creates a campaign with a budget and caller-selected status. ENABLED permits advertising once Apple’s serving requirements are met; this is not restricted to paused drafts. | Apple |
| `asa_campaigns_update` | false | true | false | true | Overwrites campaign status, countries and daily/lifetime budgets; can enable spending or pause delivery. | Apple |
| `asa_campaigns_delete` | false | true | false | true | Changes existing state: Delete a campaign. Deletion, replacement, revocation or distribution may affect existing resources. | Apple |
| `asa_adgroups_list` | true | false | true | true | Retrieves or computes: List ad groups in a campaign. No persisted job or customer-state write identified. | Apple |
| `asa_adgroups_get` | true | false | true | true | Retrieves or computes: Get an ad group. No persisted job or customer-state write identified. | Apple |
| `asa_adgroups_find` | true | false | true | true | Retrieves or computes: Find ad groups in a campaign; Find ad groups across the org. No persisted job or customer-state write identified. | Apple |
| `asa_adgroups_create` | false | true | false | true | Creates a bid-bearing ad group. An enabled group in an eligible live campaign can begin serving and spending immediately. | Apple |
| `asa_adgroups_update` | false | true | false | true | Overwrites ad-group status, bids, CPA goal, dates and Search Match behavior. | Apple |
| `asa_adgroups_delete` | false | true | false | true | Changes existing state: Delete an ad group. Deletion, replacement, revocation or distribution may affect existing resources. | Apple |
| `asa_keywords_list` | true | false | true | true | Retrieves or computes: List targeting keywords in an ad group. No persisted job or customer-state write identified. | Apple |
| `asa_keywords_get` | true | false | true | true | Retrieves or computes: Get a targeting keyword. No persisted job or customer-state write identified. | Apple |
| `asa_keywords_find` | true | false | true | true | Retrieves or computes: Find targeting keywords across a campaign. No persisted job or customer-state write identified. | Apple |
| `asa_keywords_create` | false | true | false | true | Creates targeting keywords, which can be ACTIVE with bids in a live ad group and enable spending. | Apple |
| `asa_keywords_update` | false | true | false | true | Bulk-overwrites targeting keyword status, match type or bids. | Apple |
| `asa_keywords_delete` | false | true | false | true | Changes existing state: Delete a targeting keyword; Delete targeting keywords (bulk). Deletion, replacement, revocation or distribution may affect existing resources. | Apple |
| `asa_negative_keywords_list` | true | false | true | true | Retrieves or computes: List campaign negative keywords; List ad group negative keywords. No persisted job or customer-state write identified. | Apple |
| `asa_negative_keywords_get` | true | false | true | true | Retrieves or computes: Get a campaign negative keyword; Get an ad group negative keyword. No persisted job or customer-state write identified. | Apple |
| `asa_negative_keywords_find` | true | false | true | true | Retrieves or computes: Find campaign negative keywords; Find ad group negative keywords across a campaign. No persisted job or customer-state write identified. | Apple |
| `asa_negative_keywords_create` | false | false | false | true | Adds state: Create campaign negative keywords (bulk); Create ad group negative keywords (bulk). No existing-resource overwrite or irreversible transaction identified in the reviewed path. | Apple |
| `asa_negative_keywords_update` | false | true | false | true | Bulk-overwrites negative keyword configuration and can change which traffic is excluded. | Apple |
| `asa_negative_keywords_delete` | false | true | false | true | Changes existing state: Delete campaign negative keywords; Delete ad group negative keywords. Deletion, replacement, revocation or distribution may affect existing resources. | Apple |
| `asa_ads_list` | true | false | true | true | Retrieves or computes: List ads in an ad group. No persisted job or customer-state write identified. | Apple |
| `asa_ads_get` | true | false | true | true | Retrieves or computes: Get an ad. No persisted job or customer-state write identified. | Apple |
| `asa_ads_find` | true | false | true | true | Retrieves or computes: Find ads in a campaign; Find ads across the org. No persisted job or customer-state write identified. | Apple |
| `asa_ads_create` | false | true | false | true | Creates an ad assigned to a creative. An ENABLED ad in an eligible live group can begin serving and spending immediately. | Apple |
| `asa_ads_update` | false | true | false | true | Overwrites ad status/name; pausing or enabling changes delivery. | Apple |
| `asa_ads_delete` | false | true | false | true | Changes existing state: Delete an ad. Deletion, replacement, revocation or distribution may affect existing resources. | Apple |
| `asa_creatives_list` | true | false | true | true | Retrieves or computes: List creatives. No persisted job or customer-state write identified. | Apple |
| `asa_creatives_get` | true | false | true | true | Retrieves or computes: Get a creative. No persisted job or customer-state write identified. | Apple |
| `asa_creatives_find` | true | false | true | true | Retrieves or computes: Find creatives with a selector. No persisted job or customer-state write identified. | Apple |
| `asa_creatives_create` | false | false | false | true | Adds state: Create a creative. No existing-resource overwrite or irreversible transaction identified in the reviewed path. | Apple |
| `asa_product_pages_list` | true | false | true | true | Retrieves or computes: List an app's custom product pages. No persisted job or customer-state write identified. | Apple |
| `asa_product_pages_get` | true | false | true | true | Retrieves or computes: Get a product page. No persisted job or customer-state write identified. | Apple |
| `asa_product_pages_locales` | true | false | true | true | Retrieves or computes: Get a product page's locales. No persisted job or customer-state write identified. | Apple |
| `asa_product_pages_countries` | true | false | true | true | Retrieves or computes: List supported countries or regions. No persisted job or customer-state write identified. | Apple |
| `asa_product_pages_device_sizes` | true | false | true | true | Retrieves or computes: List app preview device sizes. No persisted job or customer-state write identified. | Apple |
| `asa_ad_rejections_find` | true | false | true | true | Retrieves or computes: Find ad creative rejection reasons. No persisted job or customer-state write identified. | Apple |
| `asa_ad_rejections_get` | true | false | true | true | Retrieves or computes: Get an ad creative rejection reason. No persisted job or customer-state write identified. | Apple |
| `asa_ad_rejections_assets` | true | false | true | true | Retrieves asset metadata with a selector using POST; does not modify assets or start a job. | Apple |
| `asa_reports_campaigns` | true | false | true | true | Retrieves or computes: Campaign-level report. No persisted job or customer-state write identified. | Apple |
| `asa_reports_adgroups` | true | false | true | true | Retrieves or computes: Ad group-level report. No persisted job or customer-state write identified. | Apple |
| `asa_reports_keywords` | true | false | true | true | Retrieves or computes: Keyword-level report; Keyword-level report within an ad group. No persisted job or customer-state write identified. | Apple |
| `asa_reports_searchterms` | true | false | true | true | Retrieves or computes: Search term-level report; Search term-level report within an ad group. No persisted job or customer-state write identified. | Apple |
| `asa_reports_ads` | true | false | true | true | Retrieves or computes: Ad-level report. No persisted job or customer-state write identified. | Apple |
| `asa_impression_share_list` | true | false | true | true | Retrieves or computes: List impression share reports. No persisted job or customer-state write identified. | Apple |
| `asa_impression_share_get` | true | false | true | true | Retrieves or computes: Get an impression share report. No persisted job or customer-state write identified. | Apple |
| `asa_impression_share_create` | false | false | false | true | Creates a persisted impression-share report job; additive, but not read-only. | Apple |
| `asa_apps_search` | true | false | true | true | Retrieves or computes: Search the App Store for apps. No persisted job or customer-state write identified. | Apple |
| `asa_apps_eligibility` | true | false | true | true | Retrieves app eligibility records using POST; does not change eligibility or start a job. | Apple |
| `asa_apps_get` | true | false | true | true | Retrieves or computes: Get app details. No persisted job or customer-state write identified. | Apple |
| `asa_apps_localized` | true | false | true | true | Retrieves or computes: Get localized app details. No persisted job or customer-state write identified. | Apple |
| `asa_geo_search` | true | false | true | true | Retrieves or computes: Search geolocations. No persisted job or customer-state write identified. | Apple |
| `asa_geo_get` | true | false | true | true | Retrieves geolocations by ID using POST; does not create locations or start a job. | Apple |
| `asa_budget_orders_list` | true | false | true | true | Retrieves or computes: List budget orders. No persisted job or customer-state write identified. | Apple |
| `asa_budget_orders_get` | true | false | true | true | Retrieves or computes: Get a budget order. No persisted job or customer-state write identified. | Apple |
| `asa_budget_orders_create` | false | true | false | true | Creates a financial budget order for the organization. Apple can return it ACTIVE; the request is not restricted to a draft allocation. | Apple |
| `asa_budget_orders_update` | false | true | false | true | Overwrites a financial budget order using an unrestricted request body. | Apple |
| `asa_acls_list` | true | false | true | true | Retrieves or computes: List the orgs this API user can access. No persisted job or customer-state write identified. | Apple |
| `asa_me_get` | true | false | true | true | Retrieves or computes: Show the calling API user. No persisted job or customer-state write identified. | Apple |
| `asa_keys` | true | false | true | true | Retrieves or computes: Which apps have Apple Search Ads connected. No persisted job or customer-state write identified. | Apple |
| `asa_get` | true | false | true | true | Retrieves or computes: Any GET request to the Apple Search Ads API. No persisted job or customer-state write identified. | Apple |
| `asa_post` | false | true | false | true | Executes an arbitrary Apple Ads POST. It can bulk-delete resources, activate advertising or create financial budget orders; repeating a call may repeat its effects. | Apple |
| `asa_put` | false | true | false | true | Executes an arbitrary Apple Ads PUT. It can overwrite bids, targeting, budgets and delivery status. | Apple |
| `asa_delete` | false | true | false | true | Changes existing state: Any DELETE request to the Apple Search Ads API. Deletion, replacement, revocation or distribution may affect existing resources. | Apple |
| `asa_docs` | true | false | true | true | Retrieves or computes: Every endpoint, with Apple's own schema. No persisted job or customer-state write identified. | Apple |
| `feedback` | false | true | false | false | Sends the supplied message and context to the Superwall team as a persisted event. Sending cannot be undone; repeating the call can send duplicate feedback. | feedback |
