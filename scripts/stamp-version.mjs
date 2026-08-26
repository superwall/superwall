#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const PUBLISHED = ["protocol", "runtime", "studio", "cli", "superwall"];

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;

export const isSemver = (version) => SEMVER.test(version);

export const stampVersion = (root, version) => {
  if (!isSemver(version))
    throw new Error(`"${version}" is not a semver version (expected X.Y.Z or X.Y.Z-tag.N)`);
  const stamped = [];
  for (const name of PUBLISHED) {
    const file = path.join(root, "packages", name, "package.json");
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
    if (pkg.private === true) throw new Error(`${file} is private: true — it cannot be published`);
    pkg.version = version;
    fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
    stamped.push(`${pkg.name}@${version}`);
  }
  return stamped;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = process.argv[2]?.replace(/^v/, "");
  if (!version) {
    console.error("usage: scripts/stamp-version.mjs <version>");
    process.exit(2);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (const line of stampVersion(root, version)) console.log(line);
}
