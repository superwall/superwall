import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const DISCOVER = `export const discoverProject = (root) => ({
  root,
  superwallDir: root,
  marker: "package.json",
  packageName: "acme-paywalls",
  surfaces: [{ kind: "paywall", id: "pro", dir: root + "/paywalls/pro", configFile: root + "/paywalls/pro/config.ts", routes: [] }],
  diagnostics: [],
});
`;

const BUILD = `export const buildSnapshot = async (_project, surface, options) => ({
  name: surface.id,
  snapshotId: "snap0123456789" + (options?.platform ?? "all"),
  html: "<html>" + surface.id + " " + (options?.platform ?? "all") + "</html>",
  bytes: 2048,
  htmlFile: "index.html",
});
`;

const PREVIEW = `export const startPreviewServer = async (roots, options) => {
  globalThis.__superwallPreview = { roots, options };
  return { resolvedUrls: { local: ["http://localhost:" + (options.port + 1) + "/"], network: [] } };
};
`;

export interface FakeFramework {
  discover?: string;
  build?: string;
  preview?: string;
}

export function writeFakeFrameworkProject(sources: FakeFramework = {}): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "superwall-fake-framework-")));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "acme-paywalls", dependencies: { superwall: "*" } }));
  const installed = path.join(root, "node_modules", "superwall");
  fs.mkdirSync(installed, { recursive: true });
  fs.writeFileSync(
    path.join(installed, "package.json"),
    JSON.stringify({
      name: "superwall",
      version: "9.9.9",
      type: "module",
      exports: {
        "./discover": "./discover.js",
        "./build": "./build.js",
        "./preview": "./preview.js",
        "./package.json": "./package.json",
      },
    }),
  );
  fs.writeFileSync(path.join(installed, "discover.js"), sources.discover ?? DISCOVER);
  fs.writeFileSync(path.join(installed, "build.js"), sources.build ?? BUILD);
  fs.writeFileSync(path.join(installed, "preview.js"), sources.preview ?? PREVIEW);
  return root;
}
