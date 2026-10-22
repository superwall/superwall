import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "login",
  summary: "Log in to Superwall in your browser, or with an API key",
  flags: {
    apiKey: { type: "string", value: "key", describe: "Log in with an API key instead of the browser, for CI" },
    host: { type: "string", value: "url", describe: "OAuth issuer override", hidden: true },
    clientId: { type: "string", value: "id", describe: "OAuth client id override", hidden: true },
  },
  examples: [
    ["login", "Approve the login in your browser"],
    ["login --api-key <key>", "Log in on a server or in CI"],
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
