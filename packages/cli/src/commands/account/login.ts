import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "login",
  summary: "Log in to Superwall in your browser, or with an API key",
  details:
    "Without a terminal (a coding agent, --json), login prints the link and code and returns at once; once the link is approved, `superwall login --poll` finishes it. A new account needs --org-name, and --app-name with --platform also creates its first app.",
  flags: {
    apiKey: { type: "string", value: "key", describe: "Log in with an API key instead of the browser, for CI" },
    poll: { type: "boolean", describe: "Finish a login started without a terminal, once it's approved in the browser" },
    timeout: { type: "number", value: "seconds", describe: "With --poll, seconds to wait for approval before returning (default 60)" },
    orgName: { type: "string", value: "name", describe: "Create this organization if the account has none" },
    appName: { type: "string", value: "name", describe: "With --org-name, also create this app as the organization's first" },
    platform: { type: "string", value: "platform", choices: ["ios", "android", "web"], describe: "Platform of the --app-name app" },
    bundleId: { type: "string", value: "id", describe: "Bundle ID of the --app-name app" },
    host: { type: "string", value: "url", describe: "OAuth issuer override", hidden: true },
    clientId: { type: "string", value: "id", describe: "OAuth client id override", hidden: true },
  },
  examples: [
    ["login", "Approve the login in your browser"],
    ["login --api-key <key>", "Log in on a server or in CI"],
    ["login --json", "From an agent: print the link to approve and return"],
    ["login --poll --json", "From an agent: finish the login once it's approved"],
    ["login --poll --org-name Acme --app-name Acme --platform ios", "From an agent: finish a new account's login and create its first app"],
  ],
  auth: "none",
  json: true,
  prompts: true,
  mcp: false,
  async run(ctx, input) {
    const { runLogin } = await import("@/core/account/login");
    return runLogin(ctx, input);
  },
});
