import { defineCommand } from "@/command";
import { setupApple } from "./apple";
import { appleDeps } from "./apple-deps";

export const runSetup = defineCommand({
  name: "setup",
  auth: "required",
  output: "both",
  async run(ctx) {
    const target = String(ctx.argv.target ?? "");
    if (target === "apple") return setupApple(ctx, appleDeps);
    throw new Error(`Unknown "setup ${target}". Use: setup apple`);
  },
});
