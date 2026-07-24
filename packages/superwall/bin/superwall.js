#!/usr/bin/env node
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const selfDir = fs.realpathSync(
  path.dirname(fileURLToPath(new URL("../package.json", import.meta.url))),
);

const resolveLocalBin = () => {
  try {
    const resolver = createRequire(path.join(process.cwd(), "package.json"));
    const localPackageJson = resolver.resolve("superwall/package.json");
    const localDir = fs.realpathSync(path.dirname(localPackageJson));
    if (localDir === selfDir) return undefined;
    return path.join(localDir, "bin", "superwall.js");
  } catch {
    return undefined;
  }
};

const localBin = resolveLocalBin();
if (localBin && fs.existsSync(localBin)) {
  // Hand off to the project-local install — it registers its own tsx and
  // runs its own (possibly newer or older) command set.
  await import(pathToFileURL(localBin).href);
} else {
  // Project credentials and host overrides (SUPERWALL_API_HOST,
  // SUPERWALL_RUNTIME_URL, …) conventionally live in the project's .env.
  const envFile = path.join(process.cwd(), ".env");
  if (fs.existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }

  const { register } = await import("tsx/esm/api");
  register();

  const { main } = await import("@superwall/cli");
  await main();
}
