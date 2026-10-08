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
    "setup <target>",
    "Connect a store to Superwall: sign in, create its keys, and point its notifications at Superwall",
    (y) =>
      y
        .positional("target", { type: "string", describe: "apple" })
        .options({
          "apple-id": { type: "string", describe: "Apple Account email (or set SUPERWALL_APPLE_ID)" },
          "apple-password": {
            type: "string",
            describe:
              "Apple Account password; prefer the masked prompt or SUPERWALL_APPLE_PASSWORD to keep it out of shell history and the process list",
          },
          code: { type: "string", describe: "Apple verification code, to continue a sign-in started without prompts" },
          sms: { type: "boolean", describe: "Text the verification code instead of pushing it to trusted devices" },
          phone: { type: "string", describe: "Trusted phone number to text, if the account has several" },
          team: { type: "string", describe: "Apple team id or name, if the account is on several" },
          app: { type: "string", describe: "Superwall app id or name" },
          project: { type: "string", describe: "Superwall project id" },
          "bundle-id": { type: "string", describe: "Bundle ID of the App Store Connect app" },
          "key-role": {
            type: "string",
            describe: "Role for the new App Store Connect API key: app_manager (default) or admin",
          },
          "skip-team-key": { type: "boolean", describe: "Don't create an App Store Connect API key" },
          "skip-purchase-key": { type: "boolean", describe: "Don't create an In-App Purchase key" },
          "skip-webhook": { type: "boolean", describe: "Don't set the server notification URL" },
          "dry-run": {
            type: "boolean",
            describe: "Sign in and check key access without creating or changing anything",
          },
        })
        .example("$0 setup apple", "Sign in and connect an app, with prompts")
        .example("$0 setup apple --dry-run", "Sign in and check key access; change nothing")
        .example(
          "$0 setup apple --apple-id you@example.com --app 123 --no-interactive",
          "Without prompts: reads SUPERWALL_APPLE_PASSWORD, then stops for Apple's code",
        )
        .example("$0 setup apple --code 123456 --app 123 --no-interactive", "Continue with the code"),
    (argv) => {
      return import("@/commands/platform/setup").then((m) => m.runSetup(argv));
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
