import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { SUPERWALL_SKILLS_SOURCE, VENDORED_SKILLS } from "../src/core/agent/skills";

const root = path.resolve(import.meta.dirname, "..");
const target = path.join(root, "dist", "skills");
const args = process.argv.slice(2);
const fromIndex = args.indexOf("--from");
const fromArg = fromIndex === -1 ? process.env.SUPERWALL_SKILLS_DIR : args[fromIndex + 1];
const from = fromArg ? path.resolve(fromArg) : undefined;

function checkout(): string {
  if (from) return from;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "superwall-skills-"));
  const tarball = path.join(scratch, "skills.tar.gz");
  const ref = process.env.SUPERWALL_SKILLS_REF ?? "main";
  const url = `https://codeload.github.com/${SUPERWALL_SKILLS_SOURCE}/tar.gz/${ref}`;
  execFileSync("curl", ["-sSfL", url, "-o", tarball], { stdio: "inherit" });
  execFileSync("tar", ["-xzf", tarball, "-C", scratch], { stdio: "inherit" });
  const extracted = fs.readdirSync(scratch).find((entry) => entry !== "skills.tar.gz");
  if (!extracted) throw new Error(`Nothing extracted from ${url}`);
  return path.join(scratch, extracted);
}

const source = checkout();
for (const name of VENDORED_SKILLS) {
  const dir = path.join(source, "skills", name);
  if (!fs.existsSync(path.join(dir, "SKILL.md"))) {
    throw new Error(`${from ?? `${SUPERWALL_SKILLS_SOURCE}@${process.env.SUPERWALL_SKILLS_REF ?? "main"}`} has no skills/${name}/SKILL.md`);
  }
  fs.rmSync(path.join(target, name), { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(dir, path.join(target, name), { recursive: true });
}
console.log(`Bundled ${VENDORED_SKILLS.length} skills into dist/skills from ${from ?? `${SUPERWALL_SKILLS_SOURCE}@${process.env.SUPERWALL_SKILLS_REF ?? "main"}`}`);
