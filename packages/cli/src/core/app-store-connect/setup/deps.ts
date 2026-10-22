import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { removePending, readPending, writePending } from "@/core/app-store-connect/apple-web/pending";
import { createAppleSession } from "@/core/app-store-connect/apple-web/session";
import { timing } from "@/core/timing";
import { appleCredentialsFromEnv } from "@/environment";
import type { AppleKeyDeps } from "../keys/create";

export const appleDeps: AppleKeyDeps = {
  session: createAppleSession,
  credentials: appleCredentialsFromEnv,
  pending: { load: () => readPending(), save: (pending) => writePending(pending), clear: removePending },
  sleep: (ms) => timing.sleep(ms),
  writeKeyFile: (name, privateKey) => {
    const path = join(process.cwd(), name);
    writeFileSync(path, privateKey, { mode: 0o600 });
    return path;
  },
};
