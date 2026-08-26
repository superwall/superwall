#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLISHED } from "./stamp-version.mjs";

const WORKSPACE = /^workspace:/;

export const publishManifest = (pkg, versions) => {
  const rewrite = (deps) => {
    if (!deps) return deps;
    const out = {};
    for (const [name, range] of Object.entries(deps)) {
      if (WORKSPACE.test(range)) {
        const version = versions[name];
        if (!version)
          throw new Error(
            `${pkg.name} depends on ${name} via ${range}, which is not a published package`,
          );
        out[name] = version;
      } else {
        out[name] = range;
      }
    }
    return out;
  };
  return {
    ...pkg,
    dependencies: rewrite(pkg.dependencies),
    peerDependencies: rewrite(pkg.peerDependencies),
    optionalDependencies: rewrite(pkg.optionalDependencies),
  };
};

export const packAll = (root, destination) => {
  const manifests = PUBLISHED.map((dir) => {
    const file = path.join(root, "packages", dir, "package.json");
    return { dir, file, original: fs.readFileSync(file, "utf8") };
  });
  const versions = Object.fromEntries(
    manifests.map(({ original }) => {
      const pkg = JSON.parse(original);
      return [pkg.name, pkg.version];
    }),
  );
  fs.mkdirSync(destination, { recursive: true });
  const tarballs = [];
  try {
    for (const { file, original } of manifests) {
      const pkg = JSON.parse(original);
      const publishable = publishManifest(pkg, versions);
      if (publishable.private === true) throw new Error(`${pkg.name} is private: true`);
      fs.writeFileSync(file, `${JSON.stringify(publishable, null, 2)}\n`);
      const name = execFileSync(
        "npm",
        ["pack", "--pack-destination", destination, "--ignore-scripts"],
        {
          cwd: path.dirname(file),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "inherit"],
        },
      ).trim();
      tarballs.push({ name: pkg.name, tarball: path.join(destination, name.split("\n").pop()) });
    }
  } finally {
    for (const { file, original } of manifests) fs.writeFileSync(file, original);
  }
  return tarballs;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const destination = path.resolve(process.argv[2] ?? ".release");
  for (const { name, tarball } of packAll(root, destination)) console.log(`${name}\t${tarball}`);
}
