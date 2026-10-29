import { defineResource } from "@/core/main/define";

export const command = defineResource({
  name: "apps",
  summary: "Every app you can open",
  appArg: true,
  operations: [
    {
      name: "list",
      summary: "Every app, by organization and project",
      effect: "read",
      handler: "resource",
      usage: "",
      flags: [
        ["--search <text>", "Only projects or apps whose id, name or bundle ID contains this"],
        ["--limit <n>", "At most this many projects"],
      ],
    },
    {
      name: "get",
      summary: "Everything about one app: bundle ID, Apple team, keys, URLs",
      effect: "read",
      handler: "apps.get",
      usage: "<app>",
    },
    {
      name: "create",
      summary: "Add an app to a project",
      effect: "write",
      handler: "resource",
      usage: "--name <name> --platform <platform>",
      flags: [
        ["--name <name>", "What the app is called"],
        ["--platform <p>", "ios | android | flutter | react_native | web"],
        ["--bundle-id <id>", "Bundle ID or package name"],
        ["--project <id>", "The project to add it to; a new one when left out"],
      ],
    },
    {
      name: "update",
      summary: "Change its bundle ID, Apple team ID, URL scheme, support URL, ...",
      effect: "destructive",
      handler: "apps.update",
      method: "PATCH",
      path: "/v2/projects/{id}/applications/{application_id}/settings",
      bind: { id: "project", application_id: "app" },
      mcpOmit: ["revenue_cat_public_api_key", "app_store_connect_shared_secret", "stripe_private_key"],
      flags: [
        ["--revenue-provider <p>", "Which revenue its figures count: open_revenue or revenue_cat"],
        ["-y, --yes", "Change --bundle-id or --revenue-provider without asking"],
      ],
      details: `A new --bundle-id is checked first: when builds the SDK reported in the last 30 days would
run in test mode under it, it says how many and asks.
--revenue-provider chooses which events the dashboard's revenue figures count. Events from
both sources keep arriving and being stored; it says what changes and asks first.
Outside a terminal both need --yes.

Overwrites app settings, including routing, revenue provider and bundle ID. Changing the bundle ID can put deployed builds into test mode.`,
    },
    {
      name: "use",
      summary: "Make it the app commands use when --app is left out",
      effect: "write",
      handler: "resource",
      usage: "<app>",
      mcp: false,
    },
    {
      name: "statistics",
      summary: "Users, revenue and conversion, as the dashboard's overview shows them",
      effect: "read",
      method: "GET",
      path: "/v2/projects/{id}/applications/{application_id}/statistics",
      details: `The overview figures, computed as the dashboard computes them. Pass --environment and
either --date-preset (last_7_days, last_30_days, ...) or --from and --to.
For anything the overview doesn't show, run SQL with \`superwall query\`.`,
      bind: { id: "project", application_id: "app" },
    },
    {
      name: "transactions",
      summary: "Its most recent transactions, as the dashboard lists them",
      effect: "read",
      method: "GET",
      path: "/v2/projects/{id}/applications/{application_id}/recent-transactions",
      details: `The dashboard's recent-transactions list. Pass --environment, --from and --to.
To count, group or filter transactions, run SQL with \`superwall query\`.`,
      bind: { id: "project", application_id: "app" },
      list: true,
    },
    {
      name: "notices",
      summary: "What the dashboard warns about on its overview",
      effect: "read",
      method: "GET",
      path: "/v2/projects/{id}/applications/{application_id}/overview-notices",
      bind: { id: "project", application_id: "app" },
    },
  ],
  related: [
    ["asc keys list --app <app>", "Its App Store Connect and In-App Purchase keys"],
    ["asc notification-url check --app <app>", "Whose URL Apple sends its purchase events to"],
    ["setup apple --app <app>", "Connect it to Apple in one sign-in"],
  ],
  examples: [
    ["apps get <app>", "Everything about one app"],
    ["apps list --search <text>", "Find an app by id, name or bundle ID"],
    ["apps update <app> --team-id <team-id>", "Change one field"],
  ],
});
