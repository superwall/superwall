import yargs from "yargs";
import type { Argv } from "yargs";
import { hideBin } from "yargs/helpers";
import pc from "picocolors";
import { ENV_API_KEY, VERSION } from "@/constants";
import { writeJson } from "@/output";

const installDirOption = {
  "install-dir": {
    describe: "Directory to set up Superwall in (default: cwd)",
    type: "string" as const,
  },
};

const apiKeyOption = {
  "api-key": {
    describe: `Superwall public API key (or set ${ENV_API_KEY})`,
    type: "string" as const,
  },
};

const dryRunOption = {
  "dry-run": {
    type: "boolean" as const,
    describe: "Plan without changing anything",
    hidden: true,
  },
};

const skillOption = {
  skill: {
    type: "boolean" as const,
    describe: "Print the agent playbook (skill + this project's reference) instead of running",
  },
};

const RESOURCES = ["orgs", "apps", "products", "campaigns", "paywalls", "entitlements"] as const;

const API_VERBS = ["get", "post", "patch", "delete"] as const;

function printHelp(): void {
  const pad = (cmd: string) => `  ${cmd.padEnd(30)}`;
  const row = (cmd: string, desc: string) => `${pad(cmd)}${desc}`;
  const head = (title: string) => pc.bold(`${title}:`);
  process.stdout.write(
    [
      `${pc.bold("Superwall CLI")} ${pc.dim(`v${VERSION}`)}`,
      "",
      pc.bold("Usage:"),
      "  superwall [command]",
      "",
      head("Workflow commands"),
      row("integrate", "Set up Superwall in your app (agent-driven)"),
      row("migrate", "Migrate from RevenueCat / Adapty / Qonversion"),
      row("review [--fix]", "Audit an existing Superwall setup; --fix repairs issues"),
      pc.dim(
        "                                  Each takes --skill to print the playbook instead of running.",
      ),
      "",
      head("Paywalls & funnels"),
      row("create [dir]", "Set up paywalls in your app - creates superwall/ inside it"),
      row("dev [dir..]", "Host the studio: browse and preview your paywalls and funnels"),
      row("push [dir]", "Build and push your paywalls and funnels as immutable versions"),
      row("promote [dir]", "Point production at a pushed version"),
      row("publish [dir]", "Push and promote in one step"),
      pc.dim(
        "                                  push and publish take -m <note> to record why, in the source commit.",
      ),
      "",
      head("Resource commands"),
      row("bootstrap", "Complete account tree: projects, apps, campaigns, and products"),
      row("apps", "Projects and platform apps (list, create, use)"),
      row("products", "Products (list, create, storekit)"),
      row("entitlements", "Entitlements (list, create)"),
      row("campaigns", "Campaigns (list, create, placement)"),
      row("paywalls", "Paywalls (list)"),
      row("query [sql]", "Run SQL against your ClickHouse analytics data"),
      row("orgs", "Organizations (list, use) - only needed with multiple orgs"),
      "",
      head("API commands"),
      row("get, post, patch, delete", "Raw requests to the Superwall API (/v2/...)"),
      "",
      head("App Store Connect commands"),
      row("asc", "The ASC API via Superwall's signed proxy (no .p8 / JWT)"),
      row("asc docs", "Exact ASC request schema, from Apple's spec (path or search)"),
      row("asc keys", "Manage App Store Connect API keys (list, set, rm)"),
      "",
      head("Other commands"),
      row("login, logout, whoami", "Authenticate the CLI"),
      row("skills", "Install or update the Superwall agent skills"),
      row("doctor", "Check the health of your integration"),
      row("upgrade", "Update the CLI to the latest version"),
      row("feedback", "Send feedback about the CLI to the Superwall team"),
      "",
      pc.bold("Flags:"),
      row("--json", "Machine-readable output"),
      row("--no-interactive", "Disable prompts for automation"),
      row("-v, --version", "Print the CLI version"),
      row("-h, --help", "Help for superwall"),
      "",
      `Use ${pc.bold('"superwall [command] --help"')} for more information about a command.`,
      "",
    ].join("\n"),
  );
}

export async function run(): Promise<void> {
  const args = hideBin(process.argv);
  if (
    args.length === 0 ||
    args[0] === "help" ||
    ((args[0] === "-h" || args[0] === "--help") && args.length === 1)
  ) {
    printHelp();
    return;
  }

  let cli = yargs(args)
    .scriptName("superwall")
    .usage("Superwall CLI\n\n$0 [command]")
    .option("interactive", {
      type: "boolean",
      default: true,
      hidden: true,
      describe: "Allow prompts (use --no-interactive for automation)",
    })
    .option("json", {
      type: "boolean",
      default: false,
      describe: "Machine-readable output",
    })
    .command(
      "integrate",
      "Set up the SDK, placements, and dashboard in your app",
      (y) =>
        y.options({
          ...installDirOption,
          ...apiKeyOption,
          ...dryRunOption,
          ...skillOption,
          driver: {
            type: "string",
            choices: ["claude", "codex", "superwall"],
            describe: "Force a coding-agent backend (default: first detected)",
            hidden: true,
          },
        }),
      (argv) => {
        if (argv.skill)
          return import("@/commands/workflow/print-skill").then((m) => m.runPrintSkill("integrate")(argv));
        return import("@/commands/workflow/integrate").then((m) => m.runIntegrate(argv));
      },
    )
    .command(
      "review",
      "Review an existing Superwall setup end to end",
      (y) =>
        y.options({
          ...installDirOption,
          ...dryRunOption,
          ...skillOption,
          fix: {
            type: "boolean",
            describe: "Apply verified, safe fixes from the latest review",
          },
        }),
      (argv) => {
        const id = argv.fix ? "review-fix" : "review";
        if (argv.skill)
          return import("@/commands/workflow/print-skill").then((m) => m.runPrintSkill(id)(argv));
        return import("@/commands/workflow/integrate").then((m) => m.runActionCommand(id)(argv));
      },
    )
    .command(
      "migrate",
      "Migrate from RevenueCat / Adapty / Qonversion to Superwall",
      (y) =>
        y.options({
          ...installDirOption,
          "dry-run": { type: "boolean", describe: "Plan without changes" },
          ...skillOption,
        }),
      (argv) => {
        if (argv.skill)
          return import("@/commands/workflow/print-skill").then((m) => m.runPrintSkill("migrate")(argv));
        return import("@/commands/workflow/migrate").then((m) => m.runMigrate(argv));
      },
    )
    .command(
      "login",
      "Log in to Superwall (opens your browser)",
      (y) =>
        y.options({
          "api-key": {
            type: "string",
            describe: "Log in headlessly with an API key (for CI) instead of the browser",
          },
          host: {
            type: "string",
            describe: "OAuth issuer override",
            hidden: true,
          },
          "client-id": {
            type: "string",
            describe: "OAuth client id override",
            hidden: true,
          },
        }),
      (argv) => {
        return import("@/commands/account/auth").then((m) => m.runLogin(argv));
      },
    )
    .command(
      "logout",
      "Log out of Superwall",
      (y) => y,
      (argv) => {
        return import("@/commands/account/auth").then((m) => m.runLogout(argv));
      },
    )
    .command(
      "whoami",
      "Show the logged-in Superwall account",
      (y) => y,
      (argv) => {
        return import("@/commands/account/auth").then((m) => m.runWhoami(argv));
      },
    )
    .command(
      "skills",
      "Install or update the Superwall agent skills for your coding agent",
      (y) =>
        y.options({
          skill: {
            type: "array",
            describe: "Install specific skills by name (default: all)",
          },
          force: {
            type: "boolean",
            describe: "Reinstall even if skills are already up to date",
          },
          "dry-run": {
            type: "boolean",
            describe: "Print the install command without running it",
            hidden: true,
          },
        }),
      (argv) => {
        return import("@/commands/account/skills").then((m) => m.runSkills(argv));
      },
    )
    .command(
      "doctor",
      "Check the health of your Superwall integration",
      (y) =>
        y.options({
          ...installDirOption,
        }),
      (argv) => {
        return import("@/commands/account/doctor").then((m) => m.runDoctor(argv));
      },
    )
    .command(
      "upgrade",
      "Update the CLI to the latest version",
      (y) => y,
      (argv) => {
        return import("@/commands/account/upgrade").then((m) => m.runUpgrade(argv));
      },
    )
    .command(
      "feedback [message]",
      "Send feedback about the CLI to the Superwall team",
      (y) =>
        y
          .positional("message", {
            type: "string",
            describe: "Your feedback (omit to be prompted)",
          })
          .example('$0 feedback "migrate crashed on Expo"', "Send feedback")
          .example('$0 feedback "..." --json', "For agents / automation"),
      (argv) => {
        return import("@/commands/account/feedback").then((m) => m.runFeedback(argv));
      },
    )
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
            quiet: { type: "boolean", hidden: true },
            "key-id": { type: "string", describe: "ASC key id (keys set)" },
            issuer: { type: "string", describe: "ASC issuer id (keys set)" },
            "key-file": {
              type: "string",
              describe: "Path to the .p8 key file (keys set)",
            },
            name: { type: "string", describe: "Account name (keys set)" },
            "dry-run": { type: "boolean", hidden: true },
          }),
      (argv) => {
        return import("@/commands/platform/asc").then((m) => m.runAsc(argv));
      },
    );

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

  cli = cli
    .command(
      "create [dir]",
      "Set up paywalls in your app - creates a superwall/ directory inside it",
      (y) =>
        y
          .positional("dir", {
            type: "string",
            describe: "Your app's root (default: cwd) - paywalls land in superwall/ inside it",
          })
          .options({
            example: {
              type: "string",
              describe: "Start from a public example by name, e.g. --example with-rive",
            },
            yes: {
              type: "boolean",
              alias: "y",
              describe: "Accept defaults and skip the optional prompts",
            },
            install: {
              type: "boolean",
              default: true,
              describe: "Install dependencies after scaffolding (--no-install to skip)",
            },
            connect: {
              type: "boolean",
              default: true,
              describe: "Connect a Superwall app when possible (--no-connect to skip)",
            },
          })
          .example("$0 create", "Set up superwall/ in the current app")
          .example("$0 create --example with-rive", "Start from an example"),
      (argv) => {
        return import("@/commands/paywalls/create").then((m) => m.runCreate(argv));
      },
    )
    .command(
      "dev [dir..]",
      "Host the studio: browse and preview your paywalls and funnels",
      (y) =>
        y
          .positional("dir", {
            type: "string",
            array: true,
            describe: "Project directories to serve (default: cwd)",
          })
          .options({
            port: {
              type: "number",
              default: 6100,
              alias: "p",
              describe: "Preferred port (falls back to the next free one)",
            },
            host: { type: "string", default: "0.0.0.0", describe: "Host to bind" },
          }),
      (argv) => {
        return import("@/commands/paywalls/dev").then((m) => m.runDev(argv));
      },
    )
    .command(
      "push [dir]",
      "Build and push your paywalls as immutable versions (production untouched)",
      (y) =>
        y
          .positional("dir", { type: "string", describe: "Project directory (default: cwd)" })
          .options({
            id: {
              type: "array",
              string: true,
              describe: "Limit to these paywalls or funnels by id (repeatable, or comma-separated)",
            },
            rename: {
              type: "array",
              string: true,
              describe:
                "Declare a renamed directory as <old>=<new> (repeatable) - required in CI, where the resolver cannot prompt",
            },

            message: {
              type: "string",
              alias: "m",
              describe:
                "Publish note recorded in the source commit (only lands when this publish creates a new source commit — unchanged source reuses the existing commit)",
            },
          }),
      (argv) => {
        return import("@/commands/paywalls/push").then((m) => m.runPush(argv));
      },
    )
    .command(
      "promote [dir]",
      "Point production at a pushed version (the latest by default)",
      (y) =>
        y
          .version(false)
          .positional("dir", { type: "string", describe: "Project directory (default: cwd)" })
          .options({
            id: {
              type: "array",
              string: true,
              describe: "Limit to these paywalls or funnels by id (repeatable, or comma-separated)",
            },
            version: {
              type: "number",
              alias: "v",
              describe: "Pushed version number to promote (requires a single --id)",
            },
          }),
      (argv) => {
        return import("@/commands/paywalls/promote").then((m) => m.runPromote(argv));
      },
    )
    .command(
      "publish [dir]",
      "Push and promote in one step - build, version, and ship to production",
      (y) =>
        y
          .positional("dir", { type: "string", describe: "Project directory (default: cwd)" })
          .options({
            id: {
              type: "array",
              string: true,
              describe: "Limit to these paywalls or funnels by id (repeatable, or comma-separated)",
            },
            rename: {
              type: "array",
              string: true,
              describe:
                "Declare a renamed directory as <old>=<new> (repeatable) - required in CI, where the resolver cannot prompt",
            },

            message: {
              type: "string",
              alias: "m",
              describe:
                "Publish note recorded in the source commit (only lands when this publish creates a new source commit — unchanged source reuses the existing commit)",
            },
          }),
      (argv) => {
        return import("@/commands/paywalls/publish").then((m) => m.runPublish(argv));
      },
    );

  await cli
    .command(
      "$0",
      false,
      (y) => y,
      () => printHelp(),
    )
    .version(VERSION)
    .alias("v", "version")
    .help()
    .alias("h", "help")
    .recommendCommands()
    .showHelpOnFail(false)
    .fail((msg, err) => {
      if (err) throw err;
      const friendly = msg
        .replace(/^Unknown arguments?:/, "Unknown command:")
        .replace(/^Not enough non-option arguments.*$/, "Missing a required argument.");
      if (args.includes("--json")) {
        writeJson(process.stdout, {
          error: { code: "invalid_arguments", message: friendly },
        });
      } else {
        process.stderr.write(
          `${pc.red("✗")} ${friendly}\n\nRun ${pc.bold("superwall --help")} for usage.\n`,
        );
      }
      process.exit(1);
    })
    .strict()
    .parseAsync();
}
