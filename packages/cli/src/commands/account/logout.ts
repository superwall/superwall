import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "logout",
  summary: "Log out of Superwall",
  examples: [["logout", "Forget the session on this machine"]],
  auth: "none",
  json: true,
  prompts: true,
  mcp: false,
  async run(ctx) {
    const { runLogout } = await import("@/core/account/session");
    return runLogout(ctx);
  },
});
