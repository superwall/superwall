import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { SUPERWALL_SKILLS_SOURCE, VENDORED_SKILLS, skillsRefFor } from "../src/core/support/skills";

const root = path.resolve(import.meta.dirname, "..");
const target = path.join(root, "dist", "skills");
const args = process.argv.slice(2);
const fromIndex = args.indexOf("--from");
const fromArg = fromIndex === -1 ? process.env.SUPERWALL_SKILLS_DIR : args[fromIndex + 1];
const from = fromArg ? path.resolve(fromArg) : undefined;
const refOverride = process.env.SUPERWALL_SKILLS_REF;

const checkouts = new Map<string, string>();

function checkout(ref: string): string {
  if (from) return from;
  const cached = checkouts.get(ref);
  if (cached) return cached;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-skills-"));
  const tarball = path.join(scratch, "skills.tar.gz");
  const url = `https://codeload.github.com/${SUPERWALL_SKILLS_SOURCE}/tar.gz/${ref}`;
  execFileSync("curl", ["-sSfL", url, "-o", tarball], { stdio: "inherit" });
  execFileSync("tar", ["-xzf", tarball, "-C", scratch], { stdio: "inherit" });
  const extracted = fs.readdirSync(scratch).find((entry) => entry !== "skills.tar.gz");
  if (!extracted) throw new Error(`Nothing extracted from ${url}`);
  const dir = path.join(scratch, extracted);
  checkouts.set(ref, dir);
  return dir;
}

const sources: string[] = [];
for (const [name, channel] of Object.entries(VENDORED_SKILLS)) {
  const ref = refOverride ?? skillsRefFor(channel);
  const source = checkout(ref);
  const label = from ?? `${SUPERWALL_SKILLS_SOURCE}@${ref}`;
  const dir = path.join(source, "skills", name);
  if (!fs.existsSync(path.join(dir, "SKILL.md"))) {
    throw new Error(`${label} has no skills/${name}/SKILL.md`);
  }
  fs.rmSync(path.join(target, name), { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(dir, path.join(target, name), { recursive: true });
  sources.push(`${name} from ${label}`);
}
console.log(`Bundled ${sources.length} skills into dist/skills: ${sources.join(", ")}`);
