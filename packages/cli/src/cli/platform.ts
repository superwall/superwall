import type { Argv } from "yargs";

export const registerPlatformCommands = <T>(cli: Argv<T>): Argv<T> =>
  cli
  .command(
    "query [sql]",
    "Run SQL against your ClickHouse analytics data",
    (y) =>
      y
        .positional("sql", {
          type: "string",
          describe: "SQL query (or pass it with --file / stdin)",
        })
        .options({
          file: { type: "string", describe: "Read SQL from a .sql file" },
        })
        .example('$0 query "SHOW TABLES FROM sw"', "Run an inline query")
        .example("$0 query --file report.sql --json", "Run a saved query"),
    (argv) => {
      return import("@/commands/platform/query").then((m) => m.runQuery(argv));
    },
  )
  .command(
    "bundle",
    "Bundle paywalls and the static config into your app, for first launches and offline",
    (y) =>
      y
        .options({
          placement: {
            type: "string",
            array: true,
            describe: "Bundle every paywall this placement can show (repeatable)",
          },
          paywall: {
            type: "string",
            array: true,
            describe: "Bundle this paywall by identifier or id (repeatable)",
          },
          all: { type: "boolean", describe: "Bundle every paywall in the static config" },
          out: { type: "string", describe: "Output directory (default: ./Superwall.bundle)" },
          key: {
            type: "string",
            describe: "The app's public API key (or SUPERWALL_PUBLIC_API_KEY); no login needed",
          },
          app: { type: "string", describe: "Superwall app id, to look the key up when logged in" },
        })
        .example("$0 bundle --placement onboarding --key pk_...", "Bundle the onboarding in CI")
        .example("$0 bundle --paywall halo --app 52518 --out ios/App/Superwall.bundle", "Bundle one paywall"),
    (argv) => {
      return import("@/commands/platform/bundle").then((m) => m.runBundle(argv));
    },
  )
  .command(
    "asc <target> [value] [value2]",
    "Call the App Store Connect API through Superwall's signed proxy (no .p8 / JWT needed)",
    (y) =>
      y
        .positional("target", {
          type: "string",
          describe:
            "get|post|patch|delete, a raw path (/v1/...), or: apps | products | subscriptions | iaps | docs | keys",
        })
        .positional("value", {
          type: "string",
          describe:
            "Path (for a verb), app bundle id / ASC app id (shortcuts), docs path or search, or list|set|rm (keys)",
        })
        .positional("value2", {
          type: "string",
          describe: "Team id (keys rm)",
        })
        .options({
          d: {
            type: "array",
            describe:
              "Request param, Stripe-style: -d key=value (string) or key:=value (number/bool/json); nesting via key[sub]",
          },
          team: {
            type: "string",
            describe: "ASC team id (if the org has more than one connected)",
          },
          force: {
            type: "boolean",
            describe: "Skip request-body schema validation and send as-is (post/patch)",
          },
          quiet: { type: "boolean", hidden: true, describe: "Suppress progress output" },
          "key-id": { type: "string", describe: "ASC key id (keys set)" },
          issuer: { type: "string", describe: "ASC issuer id (keys set)" },
          "key-file": {
            type: "string",
            describe: "Path to the .p8 key file (keys set)",
          },
          name: { type: "string", describe: "Account name (keys set)" },
          "dry-run": { type: "boolean", hidden: true, describe: "Plan without writing" },
        }),
    (argv) => {
      return import("@/commands/platform/asc").then((m) => m.runAsc(argv));
    },
  )
  .command(
    "asa <target> [action] [value]",
    "Call the Apple Search Ads API through Superwall's proxy (no key or token handling)",
    (y) =>
      y
        .positional("target", {
          type: "string",
          describe:
            "A resource (campaigns, adgroups, keywords, negative-keywords, ads, creatives, product-pages, ad-rejections, reports, impression-share, apps, geo, budget-orders, acls, me), get|post|put|delete, a raw path (/campaigns), docs, or keys",
        })
        .positional("action", {
          type: "string",
          describe: "list | get | find | create | update | delete | ... (see asa docs <resource>), or the path for a verb",
        })
        .positional("value", {
          type: "string",
          describe: "Id (comma-separated for bulk), search query, or App Store app id",
        })
        .options({
          app: { type: "string", describe: "Superwall app id or name (if several have Apple Search Ads connected)" },
          "org-id": { type: "string", describe: "Apple Search Ads org id (X-AP-Context), if the API user spans several" },
          campaign: { type: "string", describe: "Campaign id" },
          adgroup: { type: "string", describe: "Ad group id" },
          "adam-id": { type: "string", describe: "App Store app id (adamId)" },
          d: {
            type: "array",
            describe:
              "Body field, Stripe-style: -d key=value (string) or key:=value (number/bool/json); nesting via key[sub]. Query params on get/delete",
          },
          body: { type: "string", describe: "Request body as JSON: inline, @file, or @- for stdin" },
          selector: { type: "string", describe: "Apple selector as JSON (find, reports): inline, @file, or @-" },
          field: { type: "string", describe: "Selector shorthand: field name (with --op and --values)" },
          op: { type: "string", describe: "Selector shorthand: EQUALS, IN, CONTAINS, STARTSWITH, ..." },
          values: { type: "string", describe: "Selector shorthand: comma-separated values" },
          "order-by": { type: "string", describe: "Selector sort: field[:asc|desc]" },
          fields: { type: "string", describe: "Comma-separated fields to return (partial fetch)" },
          limit: { type: "number", describe: "Page size" },
          offset: { type: "number", describe: "Page offset" },
          all: { type: "boolean", describe: "Walk every page" },
          currency: { type: "string", describe: "Currency for money flags (defaults to the account's)" },
          name: { type: "string", describe: "Name for the created or updated entity" },
          status: { type: "string", describe: "ENABLED, PAUSED (keywords: ACTIVE, PAUSED)" },
          countries: { type: "string", describe: "Comma-separated country codes" },
          budget: { type: "string", describe: "Lifetime budget amount" },
          "daily-budget": { type: "string", describe: "Daily budget amount" },
          "supply-sources": { type: "string", describe: "Comma-separated supply sources" },
          "ad-channel-type": { type: "string", describe: "SEARCH or DISPLAY" },
          "billing-event": { type: "string", describe: "TAPS or IMPRESSIONS" },
          "default-bid": { type: "string", describe: "Ad group default bid" },
          "cpa-goal": { type: "string", describe: "Ad group CPA goal" },
          "search-match": { type: "boolean", describe: "Ad group Search Match" },
          text: { type: "string", describe: "Keyword text" },
          "match-type": { type: "string", describe: "BROAD or EXACT" },
          bid: { type: "string", describe: "Keyword bid amount" },
          "creative-id": { type: "string", describe: "Creative id (ads create)" },
          type: { type: "string", describe: "Creative type" },
          "product-page-id": { type: "string", describe: "Custom product page id" },
          start: { type: "string", describe: "Start date (YYYY-MM-DD)" },
          end: { type: "string", describe: "End date (YYYY-MM-DD)" },
          granularity: { type: "string", describe: "HOURLY, DAILY, WEEKLY, or MONTHLY" },
          "group-by": { type: "string", describe: "Report dimension (e.g. countryOrRegion)" },
          "time-zone": { type: "string", describe: "Report time zone: UTC or ORTZ" },
          dimensions: { type: "string", describe: "Impression share dimensions" },
          metrics: { type: "string", describe: "Impression share metrics" },
          owned: { type: "boolean", describe: "apps search: only apps this org owns" },
          country: { type: "string", describe: "geo search: country code" },
          entity: { type: "string", describe: "geo: Country, AdminArea, or Locality" },
          "adgroup-level": { type: "boolean", describe: "negative-keywords find: search ad group negatives" },
          states: { type: "string", describe: "product-pages list: comma-separated states" },
          "device-classes": { type: "string", describe: "product-pages: comma-separated device classes" },
          "language-codes": { type: "string", describe: "product-pages: comma-separated language codes" },
          expand: { type: "boolean", describe: "product-pages: include nested versions" },
          "include-deleted-assets": { type: "boolean", describe: "product-pages: include deleted assets" },
        }),
    (argv) => {
      return import("@/commands/platform/asa").then((m) => m.runAsa(argv));
    },
  );;
