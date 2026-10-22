import { defineCommand } from "@/program/command";

export const command = defineCommand({
  name: "dev",
  summary: "Host the studio: browse and preview your paywalls and funnels",
  args: {
    dir: { describe: "Project directories to serve (default: cwd)", variadic: true },
  },
  flags: {
    port: { type: "number", alias: "p", default: 6100, describe: "Preferred port (falls back to the next free one)" },
    host: { type: "string", value: "host", default: "0.0.0.0", describe: "Host to bind" },
    open: { type: "string", value: "path", hidden: true, describe: "Open the browser at this studio path once the server is up" },
  },
  examples: [
    ["dev", "Open the studio on the project in this directory"],
    ["dev apps/*/superwall --port 6200", "Serve several projects from one studio, on another port"],
  ],
  auth: "none",
  json: false,
  prompts: true,
  mcp: false,
  channel: "next",
  async run(ctx, { args, flags }) {
    const { runStudio } = await import("@/core/paywalls/studio/server");
    await runStudio({
      dirs: args.dir,
      port: flags.port,
      host: flags.host,
      open: flags.open,
      interactive: ctx.interactive,
    });
  },
});
