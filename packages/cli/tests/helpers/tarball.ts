import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { gzipSync } from "node:zlib";

export function exampleTarball(name: string, ref = "main", repo = "superwall"): Buffer {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-tarball-"));
  const prefix = `${repo}-${ref.replace(/\//g, "-")}`;
  const dir = path.join(staging, prefix, "examples", name);
  fs.mkdirSync(path.join(dir, "paywalls", name), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: `example-${name}`, dependencies: { superwall: "^1.0.0" } }),
  );
  fs.writeFileSync(path.join(dir, "paywalls", name, "config.ts"), "export default {};\n");

  const archive = path.join(staging, "example.tar");
  execFileSync("tar", ["-cf", archive, "-C", staging, prefix]);
  const bytes = gzipSync(fs.readFileSync(archive));
  fs.rmSync(staging, { recursive: true, force: true });
  return bytes;
}
