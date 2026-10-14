import pc from "picocolors";
import { CHANNEL, VERSION } from "@/environment";

export function printHelp(): void {
  const pad = (cmd: string) => `  ${cmd.padEnd(30)}`;
  const row = (cmd: string, desc: string) => `${pad(cmd)}${desc}`;
  const head = (title: string) => pc.bold(`${title}:`);
  const next = CHANNEL() === "next";
  process.stdout.write(
    [
      `${pc.bold("Superwall CLI")} ${pc.dim(`v${VERSION}`)}${next ? pc.dim(" · next channel") : ""}`,
      "",
      pc.bold("Usage:"),
      "  superwall [command]",
      "",
      head("Workflow commands"),
      row("integrate", "Set up Superwall in your app (agent-driven)"),
      row("migrate", "Migrate from RevenueCat / Adapty / Qonversion"),
      ...(next
        ? [
            row("migrate <paywall-id>", "Rebuild a dashboard paywall as code with your agent"),
            row("migrate --screen <path>", "Rebuild a native screen as a Superwall surface"),
          ]
        : []),
      row("review [--fix]", "Audit an existing Superwall setup; --fix repairs issues"),
      pc.dim(
        "                                  Each takes --skill to print the playbook instead of running.",
      ),
      "",
      ...(next
        ? [
            head("Paywalls & funnels"),
            row("create [dir]", "Set up paywalls in your app - creates superwall/ inside it"),
            row("dev [dir..]", "Host the studio: browse and preview your paywalls and funnels"),
            row("build [dir]", "Build the snapshot documents a push would version, without pushing"),
            row("push [dir]", "Build and push your paywalls and funnels as immutable versions"),
            row("promote [dir]", "Point production at a pushed version"),
            row("publish [dir]", "Push and promote in one step"),
            pc.dim(
              "                                  push and publish take -m <note> to record why, in the source commit.",
            ),
            pc.dim(
              "                                  All four take --platform <p> when the project pushes to several platforms.",
            ),
            "",
          ]
        : []),
      head("Resource commands"),
      row("bootstrap", "Complete account tree: projects, apps, campaigns, and products"),
      row("apps", "Projects and platform apps (list, create, use, bundle-id)"),
      row("products", "Products (list, create, storekit)"),
      row("entitlements", "Entitlements (list, create)"),
      row("campaigns", "Campaigns (list, create, placement)"),
      row("paywalls", "Paywalls (list)"),
      row("query [sql]", "Run SQL against your ClickHouse analytics data"),
      row("revenue-provider", "Which revenue source an app's figures count (get, set)"),
      row("orgs", "Organizations (list, use) - only needed with multiple orgs"),
      "",
      head("API commands"),
      row("get, post, patch, delete", "Raw requests to the Superwall API (/v2/...)"),
      "",
      head("App Store Connect commands"),
      row("asc", "The ASC API via Superwall's signed proxy (no .p8 / JWT)"),
      row("asc docs", "Exact ASC request schema, from Apple's spec (path or search)"),
      row("asc keys", "Apple keys for the organization, or an app with --app"),
      pc.dim(
        "                                  list, set, rm, create, sources, copy, import",
      ),
      row("asc notification-url", "An app's server notification URL (get, check, set)"),
      row("setup apple", "One sign-in: create the keys an app is missing, set the URL"),
      "",
      head("Apple Search Ads commands"),
      row("asa", "The Apple Ads API via Superwall's proxy (campaigns, keywords, reports, ...)"),
      row("asa docs", "Every endpoint, with Apple's own schema (group, group action, or search)"),
      row("asa keys", "Which apps have Apple Search Ads connected"),
      "",
      head("Other commands"),
      row("login, logout, whoami", "Authenticate the CLI"),
      row("skills", "Install or update the Superwall agent skills"),
      row("doctor", "Check the health of your integration"),
      row("upgrade", "Update the CLI to the latest version"),
      row("feedback", "Report a bug or send feedback to the Superwall team"),
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
