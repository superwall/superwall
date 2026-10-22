import { defineCommand } from "@/program/command";
import { runWhoami } from "@/core/account/session";

export const command = defineCommand({
  name: "whoami",
  summary: "Show the logged-in Superwall account",
  examples: [["whoami", "The account, the credential and the API host"]],
  auth: "none",
  json: true,
  prompts: false,
  mcp: false,
  run(ctx) {
    return runWhoami(ctx);
  },
});
