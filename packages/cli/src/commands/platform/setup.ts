import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineCommand } from "@/command";
import { appleCredentialsFromEnv } from "@/environment";
import { clearPending, loadPending, savePending } from "@/core/apple/pending";
import { createAppleSession } from "@/core/apple/session";
import { setupApple, type AppleSetupDeps } from "./apple";

const appleDeps: AppleSetupDeps = {
  session: createAppleSession,
  credentials: appleCredentialsFromEnv,
  pending: { load: () => loadPending(), save: (pending) => savePending(pending), clear: clearPending },
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  writeKeyFile: (name, privateKey) => {
    const path = join(process.cwd(), name);
    writeFileSync(path, privateKey, { mode: 0o600 });
    return path;
  },
};

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
