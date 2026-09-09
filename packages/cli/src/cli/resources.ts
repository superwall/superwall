import type { Argv } from "yargs";
import { API_VERBS, RESOURCES } from "./options";

export const registerResourceCommands = <T>(input: Argv<T>): Argv<T> => {
  let cli = input;
  const RESOURCE_HELP: Partial<Record<(typeof RESOURCES)[number], string>> = {
    orgs: "Your Superwall organizations (list, use <id|name>)",
    apps: "Your apps, grouped by project (list, create <name> --platform ios, use <id>)",
  };

  for (const resource of RESOURCES) {
    cli = cli.command(
      `${resource} [action] [value] [value2]`,
      RESOURCE_HELP[resource] ?? `Manage Superwall ${resource} (list, create)`,
      (y) =>
        y
          .positional("action", {
            type: "string",
            default: "list",
            describe: "list | create | placement | use | storekit",
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
            app: { type: "string", describe: "Scope to an application id" },
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
            "dry-run": { type: "boolean", describe: "Plan without writing" },
          }),
      (argv) => {
        return import("@/commands/resource/resource").then((m) => m.runResource(resource)(argv));
      },
    );
  }

  cli = cli.command(
    "bootstrap",
    "Complete account tree: orgs, projects, apps, campaigns, placements, and products",
    (y) => y,
    (argv) => {
      return import("@/commands/platform/api").then((m) => m.runBootstrap(argv));
    },
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
