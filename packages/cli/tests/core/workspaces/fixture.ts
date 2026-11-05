import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach } from "node:test";
import type { RunWrangler } from "@/core/workspaces/bundle";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

export const MANIFEST = {
  name: "Test workspace",
  scopes: ["data:read"],
  entrypoints: [
    { id: "home", slot: "org.page@1", title: "Home", path: "/home" },
    { id: "panel", slot: "user.panel@1", title: "Panel", path: "/panel" },
    {
      id: "count",
      slot: "chart.source@1",
      title: "Count",
      metric: {
        value_type: "number",
        breakdowns: [{ key: "store", name: "Store" }],
        filters: [{ key: "store", name: "Store", values: [{ value: "APP_STORE", label: "App Store" }] }],
      },
    },
    { id: "lift", slot: "campaign.metric@1", title: "Lift", metric: { value_type: "number" } },
  ],
};

export function scratch(name = "workspace"): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `sw-${name}-`)));
  dirs.push(dir);
  return dir;
}

export function workspaceProject(manifest: unknown = MANIFEST): string {
  const root = scratch();
  fs.writeFileSync(path.join(root, "superwall.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "test-workspace", private: true }));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "worker.ts"), "export default {}\n");
  return root;
}

export function writeVendoredSdk(root: string, version: string): void {
  const dir = path.join(root, "vendor", "workspace-sdk");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@superwall/workspace-sdk", version }));
}

function flag(args: readonly string[], name: string): string {
  const value = args[args.indexOf(name) + 1];
  if (value === undefined) throw new Error(`no ${name}`);
  return value;
}

export function fakeWrangler(
  module: string | (() => string) = "export default {}\n",
  options: { exports?: string[]; extra?: string; entry?: boolean } = {},
): RunWrangler {
  return async (root, args) => {
    const out = flag(args, "--outdir");
    const output = path.join(out, "worker.js");
    fs.writeFileSync(output, typeof module === "string" ? module : module());
    fs.writeFileSync(path.join(out, "worker.js.map"), "{}");
    fs.writeFileSync(path.join(out, "README.md"), "side file");
    if (options.extra) fs.writeFileSync(path.join(out, options.extra), "extra");
    const info = options.entry === false ? {} : { entryPoint: "src/worker.ts", exports: options.exports ?? ["default"] };
    fs.writeFileSync(
      flag(args, "--metafile"),
      JSON.stringify({ outputs: { [path.relative(root, output)]: info } }),
    );
  };
}

export function repoTarball(files: Record<string, string>): Buffer {
  const stage = scratch("tarball");
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(stage, "superwall-main", file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  const tarball = path.join(stage, "repo.tar.gz");
  execFileSync("tar", ["-czf", tarball, "-C", stage, "superwall-main"]);
  return fs.readFileSync(tarball);
}

export function respondWith(status: number, body: Buffer): () => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  json(): Promise<unknown>;
}> {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
    json: async () => JSON.parse(body.toString()),
  });
}
