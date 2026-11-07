#!/usr/bin/env node
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const selfDir = fs.realpathSync(
  path.dirname(fileURLToPath(new URL("../package.json", import.meta.url))),
);

const anchors = () => [
  path.join(process.cwd(), "superwall", "package.json"),
  path.join(process.cwd(), "package.json"),
];

const resolveLocalBin = () => {
  for (const anchor of anchors()) {
    try {
      const localPackageJson = createRequire(anchor).resolve("superwall/package.json");
      const localDir = fs.realpathSync(path.dirname(localPackageJson));
      if (localDir === selfDir) return undefined;
      return path.join(localDir, "bin", "superwall.js");
    } catch {
      continue;
    }
  }
  return undefined;
};

const dependsOnSuperwall = (dir) => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    return ["dependencies", "devDependencies", "peerDependencies"].some(
      (field) => pkg?.[field]?.superwall !== undefined,
    );
  } catch {
    return false;
  }
};

const projectTsconfig = () => {
  const nested = path.join(process.cwd(), "superwall");
  const projectDir = fs.existsSync(path.join(nested, "package.json"))
    ? nested
    : dependsOnSuperwall(process.cwd())
      ? process.cwd()
      : undefined;
  if (projectDir === undefined) return false;
  const tsconfig = path.join(projectDir, "tsconfig.json");
  return fs.existsSync(tsconfig) ? tsconfig : false;
};

const localBin = resolveLocalBin();
if (localBin && fs.existsSync(localBin)) {
  // Hand off to the project-local install — it registers its own tsx and
  // runs its own (possibly newer or older) command set.
  await import(pathToFileURL(localBin).href);
} else {
  // Project credentials and host overrides (SUPERWALL_API_HOST,
  // SUPERWALL_RUNTIME_URL, …) conventionally live in the project's .env.
  for (const envFile of [
    path.join(process.cwd(), "superwall", ".env"),
    path.join(process.cwd(), ".env"),
  ]) {
    if (fs.existsSync(envFile)) {
      process.loadEnvFile(envFile);
    }
  }

  const { register } = await import("tsx/esm/api");
  const tsconfig = projectTsconfig();
  try {
    register({ tsconfig });
  } catch (error) {
    if (tsconfig === false) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `Couldn't read ${path.relative(process.cwd(), tsconfig)} (${reason}) — loading TypeScript without it.\n`,
    );
    register({ tsconfig: false });
  }

  const { main } = await import("@superwall/cli");
  await main();
}
