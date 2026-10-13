import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { appleCredentialsFromEnv } from "@/environment";
import { clearPending, loadPending, savePending } from "@/core/apple/pending";
import { createAppleSession } from "@/core/apple/session";
import type { AppleKeyDeps } from "./apple-keys";

export const appleDeps: AppleKeyDeps = {
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
