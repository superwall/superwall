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

const readVersion = (dir) => {
  try {
    const { version } = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
};

const installOwner = (packageJson) => {
  const marker = `${path.sep}node_modules${path.sep}`;
  const index = packageJson.indexOf(marker);
  return index === -1 ? path.dirname(packageJson) : packageJson.slice(0, index);
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

const dirsBetween = (from, to) => {
  const dirs = [];
  for (let dir = from; ; dir = path.dirname(dir)) {
    dirs.push(dir);
    if (dir === to || dir === path.dirname(dir)) return dirs;
  }
};

const pinOwner = (anchorDir, owner) =>
  dirsBetween(anchorDir, owner).find(dependsOnSuperwall) ?? owner;

const resolveLocal = () => {
  for (const anchor of anchors()) {
    try {
      const localPackageJson = createRequire(anchor).resolve("superwall/package.json");
      const localDir = fs.realpathSync(path.dirname(localPackageJson));
      if (localDir === selfDir) return undefined;
      const owner = installOwner(localPackageJson);
      return {
        bin: path.join(localDir, "bin", "superwall.js"),
        projectDir: pinOwner(path.dirname(anchor), owner),
        installDir: owner,
        version: readVersion(localDir),
      };
    } catch {
      continue;
    }
  }
  return undefined;
};

const parseVersion = (version) => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version ?? "");
  if (!match) return undefined;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4]?.split(".") ?? [],
  };
};

const compareIdentifiers = (a, b) => {
  const numeric = /^\d+$/;
  if (numeric.test(a) && numeric.test(b)) return Number(a) - Number(b);
  if (numeric.test(a)) return -1;
  if (numeric.test(b)) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
};

const isOlder = (version, than) => {
  const a = parseVersion(version);
  const b = parseVersion(than);
  if (!b) return false;
  if (!a) return true;
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] < b.core[i];
  }
  if (a.pre.length === 0 || b.pre.length === 0) return a.pre.length > b.pre.length;
  for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i++) {
    const order = compareIdentifiers(a.pre[i], b.pre[i]);
    if (order !== 0) return order < 0;
  }
  return a.pre.length < b.pre.length;
};

const LOCKFILES = [
  ["bun.lock", "bun add"],
  ["bun.lockb", "bun add"],
  ["pnpm-lock.yaml", "pnpm add"],
  ["yarn.lock", "yarn add"],
  ["package-lock.json", "npm i"],
];

const installCommand = (local) => {
  for (const dir of [...dirsBetween(local.projectDir, local.installDir), process.cwd()]) {
    const found = LOCKFILES.find(([file]) => fs.existsSync(path.join(dir, file)));
    if (found) return found[1];
  }
  return "npm i";
};

const olderLocalNotice = (local) => {
  const selfVersion = readVersion(selfDir);
  if (!isOlder(local.version, selfVersion)) return undefined;
  const tag = parseVersion(selfVersion)?.pre.length ? "next" : "latest";
  const relative = path.relative(process.cwd(), local.projectDir);
  const update = `${relative ? `cd ${relative} && ` : ""}${installCommand(local)} superwall@${tag}`;
  const where = path.join(relative, "package.json");
  return `Running superwall ${local.version ?? "of unknown version"} pinned by ${where}, not ${selfVersion}. Update it: ${update}\n`;
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

const local = resolveLocal();
if (local && fs.existsSync(local.bin)) {
  const notice = olderLocalNotice(local);
  if (notice) process.stderr.write(notice);
  await import(pathToFileURL(local.bin).href);
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
