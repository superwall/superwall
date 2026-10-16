import type { Argv } from "yargs";
import { API_VERBS, RESOURCES } from "./options";
import { APPS_HELP } from "./platform-help";

export const registerResourceCommands = <T>(input: Argv<T>): Argv<T> => {
  let cli = input;
  const RESOURCE_HELP: Partial<Record<(typeof RESOURCES)[number], string>> = {
    apps: "Every app you can open, by organization and project (list, create <name> --platform ios, use <id>, bundle-id [value])",
  };

  cli = cli.command(
    "orgs [action] [value]",
    false,
    (y) => y,
    () => import("@/commands/resource/orgs").then((m) => m.runOrgs()),
  );

  for (const resource of RESOURCES) {
    cli = cli.command(
      `${resource} [action] [value] [value2]`,
      RESOURCE_HELP[resource] ?? `Manage Superwall ${resource} (list, create)`,
      (y) =>
        y
          .positional("action", {
            type: "string",
            default: "list",
            describe: "list | create | placement | use | storekit | bundle-id (apps)",
          })
          .positional("value", {
            type: "string",
            describe: "identifier / description / campaign id",
          })
          .positional("value2", {
            type: "string",
            describe: "placement name (campaigns create / placement)",
          })
          .options({
            project: { type: "string", describe: "Scope to a project id" },
            app: { type: "string", describe: "Scope to an app (id or dashboard link)" },
            search: {
              type: "string",
              describe: "list: only rows whose id, name or identifier contains this text",
            },
            limit: { type: "number", describe: "list: at most this many rows" },
            name: {
              type: "string",
              describe: "Display name (products create)",
            },
            platform: {
              type: "string",
              describe: "ios | android | flutter | react_native | web (apps create)",
            },
            bundle: {
              type: "string",
              describe: "Bundle id / package name (apps create)",
            },
            out: {
              type: "string",
              describe: "Output file (products storekit)",
            },
            price: {
              type: "number",
              describe: "Price in major units, e.g. 9.99 (products create)",
            },
            currency: {
              type: "string",
              describe: "ISO currency, default USD (products create)",
            },
            period: {
              choices: ["day", "week", "month", "year"] as const,
              describe: "Subscription billing period (products create)",
            },
            "period-count": {
              type: "number",
              describe: "Periods per cycle, default 1 (products create)",
            },
            "trial-days": {
              type: "number",
              describe: "Free-trial length in days (products create)",
            },
            entitlement: {
              type: "array",
              describe: "Entitlement id(s) to grant (products create)",
            },
            replace: {
              type: "boolean",
              describe: "apps bundle-id: replace a bundle ID the app already has",
            },
            yes: {
              type: "boolean",
              alias: "y",
              describe: "apps bundle-id: go ahead without asking when builds would run in test mode",
            },
            "app-store-id": {
              type: "string",
              describe: "apps bundle-id: the App Store ID too, saved only when the app has none (iOS)",
            },
            "dry-run": { type: "boolean", describe: "Plan without writing" },
          })
          .epilogue(resource === "apps" ? APPS_HELP : ""),
      (argv) => {
        return import("@/commands/resource/resource").then((m) => m.runResource(resource)(argv));
      },
    );
  }

  cli = cli.command(
    "bootstrap",
    "Complete account tree: orgs, projects, apps, campaigns, placements, and products",
    (y) =>
      y.options({
        app: { type: "string", describe: "Only the project of this app (id or dashboard link)" },
        project: { type: "string", describe: "Only this project" },
      }),
    (argv) => {
      return import("@/commands/platform/api").then((m) => m.runBootstrap(argv));
    },
  );

  cli = cli.command(
    "api <action> [query..]",
    "Search the Superwall API reference: every endpoint, its parameters and body",
    (y) =>
      y
        .positional("action", { type: "string", describe: "docs" })
        .positional("query", {
          type: "string",
          array: true,
          describe: "Words to search, or a /v2 path and optionally its method",
        })
        .options({ refresh: { type: "boolean", describe: "Fetch the reference again now" } })
        .example("$0 api docs variant", "Find the endpoints for campaign variants")
        .example(
          "$0 api docs /v2/campaigns/{id}/audiences/{audience_id}/variants post",
          "One endpoint in full",
        ),
    (argv) => import("@/commands/platform/api-docs").then((m) => m.runApiDocs(argv)),
  );

  for (const verb of API_VERBS) {
    cli = cli.command(
      `${verb} <path>`,
      `Make ${verb.toUpperCase()} requests to the Superwall API`,
      (y) =>
        y
          .positional("path", {
            type: "string",
            describe: "API path, e.g. /v2/products",
          })
          .options({
            d: {
              type: "array",
              describe:
                "Param, Stripe-style: -d key=value (string) or key:=value (number/bool/json); nesting via key[sub]",
            },
          }),
      (argv) => {
        return import("@/commands/platform/api").then((m) => m.runApi(verb)(argv));
      },
    );
  }

  return cli;
};
