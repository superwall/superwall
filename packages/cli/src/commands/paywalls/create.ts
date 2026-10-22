import { app, yes } from "@/program/flags";
import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "create",
  summary: "Set up paywalls in your app - creates a superwall/ directory inside it",
  args: {
    dir: { describe: "Your app's root (default: cwd) - paywalls land in superwall/ inside it" },
  },
  flags: {
    example: { type: "string", value: "name", describe: "Start from a public example by name, e.g. --example with-rive" },
    from: {
      type: "string",
      value: "paywall-id",
      describe:
        "Rebuild an existing dashboard paywall as code: scaffold its config.ts (products, presentation, settings) and a migration brief from the paywall id",
    },
    app: { ...app, value: "id", describe: "Connect this Superwall app by id instead of detecting or asking" },
    yes: { ...yes, describe: "Accept defaults and skip the optional prompts" },
    install: { type: "boolean", default: true, describe: "Install dependencies after scaffolding (--no-install to skip)" },
    connect: { type: "boolean", default: true, describe: "Connect a Superwall app when possible (--no-connect to skip)" },
  },
  examples: [
    ["create", "Set up superwall/ in the current app"],
    ["create --example with-rive", "Start from an example"],
    ["create --from 65920", "Rebuild dashboard paywall 65920 as code"],
    ["create --app <app>", "Connect a specific Superwall app"],
  ],
  auth: "none",
  json: false,
  prompts: true,
  mcp: false,
  channel: "next",
  async run(ctx, { args, flags }) {
    const { runCreate } = await import("@/core/paywalls/project/create");
    return runCreate(ctx, { dir: args.dir, ...flags });
  },
});
