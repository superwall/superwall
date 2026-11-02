import * as fs from "node:fs";
import * as path from "node:path";
import type { FrameworkProject, FrameworkSurface } from "./framework";

export interface TokenFinding {
  file: string;
  line: number;
  literal: string;
  tokens: string[];
}

type Category = "text" | "leading" | "tracking" | "weight" | "radius" | "space";

const TOKENS_FILE = path.join("design", "tokens.css");
const SCANNED = /\.(css|tsx|ts|jsx|js)$/;
const SKIPPED_DIRS = new Set(["node_modules", ".superwall", "dist", "public", "assets"]);

const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
const LENGTH = /(?<![\w.#-])-?\d*\.?\d+(?:px|rem|em)\b/g;
const NUMBER = /(?<![\w.#%-])\d*\.?\d+(?![\w.%(])/g;
const DECLARATION =
  /(?<![\w-])["']?([a-zA-Z][\w-]*)["']?\s*:\s*((?:[^;{},]|,(?!\s*["']?[a-zA-Z][\w-]*["']?\s*:))+)/g;

const PREFIXES: Record<Category, string> = {
  text: "--text-",
  leading: "--leading-",
  tracking: "--tracking-",
  weight: "--weight-",
  radius: "--radius",
  space: "--space-",
};

const kebab = (name: string): string => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

function categoryOf(property: string): Category | null {
  if (property === "font-size") return "text";
  if (property === "line-height") return "leading";
  if (property === "letter-spacing") return "tracking";
  if (property === "font-weight") return "weight";
  if (property.includes("radius")) return "radius";
  if (/^(padding|margin|gap|row-gap|column-gap)(-|$)/.test(property)) return "space";
  return null;
}

function normalizeColor(literal: string): string {
  const value = literal.toLowerCase().replace(/\s+/g, "");
  if (!value.startsWith("#")) return value;
  const hex = value.slice(1);
  const long = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join("") : hex;
  return `#${long.length === 8 && long.endsWith("ff") ? long.slice(0, 6) : long}`;
}

function normalizeLength(literal: string): string {
  const unit = literal.match(/(px|rem|em)$/)?.[1];
  const amount = Number.parseFloat(literal);
  if (unit === "rem") return `${amount * 16}px`;
  return `${amount}${unit ?? ""}`;
}

function tokenLiteral(value: string): { kind: "color" | "length" | "number"; value: string } | null {
  const trimmed = value.trim();
  if (/^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/.test(trimmed)) return { kind: "color", value: normalizeColor(trimmed) };
  if (/^-?\d*\.?\d+(px|rem|em)$/.test(trimmed)) return { kind: "length", value: normalizeLength(trimmed) };
  if (/^\d*\.?\d+$/.test(trimmed)) return { kind: "number", value: String(Number(trimmed)) };
  return null;
}

interface TokenIndex {
  colors: Map<string, Set<string>>;
  values: Map<string, Set<string>>;
}

export function readTokens(css: string): TokenIndex {
  const index: TokenIndex = { colors: new Map(), values: new Map() };
  for (const match of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
    const [, name, raw] = match;
    if (!name || raw === undefined) continue;
    const literal = tokenLiteral(raw);
    if (!literal) continue;
    const map = literal.kind === "color" ? index.colors : index.values;
    const key = literal.kind === "color" ? literal.value : `${literal.kind}:${literal.value}`;
    map.set(key, (map.get(key) ?? new Set()).add(name));
  }
  return index;
}

function lintValue(index: TokenIndex, property: string, value: string): Array<{ literal: string; tokens: string[] }> {
  const findings: Array<{ literal: string; tokens: string[] }> = [];
  for (const [literal] of value.matchAll(COLOR)) {
    const tokens = index.colors.get(normalizeColor(literal));
    if (tokens) findings.push({ literal, tokens: [...tokens].sort() });
  }
  const category = categoryOf(property);
  if (!category) return findings;
  const prefix = PREFIXES[category];
  const unitless = category === "weight" || category === "leading";
  const literals = [...value.replace(COLOR, " ").matchAll(LENGTH)].map(([literal]) => ({ literal, key: `length:${normalizeLength(literal)}` }));
  if (unitless) {
    for (const [literal] of value.replace(COLOR, " ").replace(LENGTH, " ").matchAll(NUMBER)) {
      literals.push({ literal, key: `number:${Number(literal)}` });
    }
  }
  for (const { literal, key } of literals) {
    if (Number.parseFloat(literal) === 0) continue;
    const tokens = [...(index.values.get(key) ?? [])].filter((name) => name.startsWith(prefix)).sort();
    if (tokens.length > 0) findings.push({ literal, tokens });
  }
  return findings;
}

export function lintSource(index: TokenIndex, text: string): Array<{ line: number; literal: string; tokens: string[] }> {
  const findings: Array<{ line: number; literal: string; tokens: string[] }> = [];
  const lines = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " ")).split("\n");
  for (const [index_, line] of lines.entries()) {
    if (/^\s*\/\//.test(line)) continue;
    for (const [, rawProperty, rawValue] of line.matchAll(DECLARATION)) {
      if (!rawProperty || rawValue === undefined) continue;
      for (const finding of lintValue(index, kebab(rawProperty), rawValue.replace(/["'`]/g, " "))) {
        findings.push({ line: index_ + 1, ...finding });
      }
    }
  }
  return findings;
}

function walk(dir: string, into: string[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) walk(full, into);
    } else if (SCANNED.test(entry.name)) into.push(full);
  }
}

export function lintDesignTokens(project: FrameworkProject, surfaces: readonly FrameworkSurface[]): TokenFinding[] {
  const tokensFile = path.join(project.superwallDir, TOKENS_FILE);
  if (!fs.existsSync(tokensFile)) return [];
  const index = readTokens(fs.readFileSync(tokensFile, "utf8"));
  if (index.colors.size === 0 && index.values.size === 0) return [];

  const files: string[] = [];
  for (const dir of [...surfaces.map((surface) => surface.dir), path.join(project.superwallDir, "components")]) {
    if (fs.existsSync(dir)) walk(dir, files);
  }
  return [...new Set(files)].flatMap((file) =>
    lintSource(index, fs.readFileSync(file, "utf8")).map((finding) => ({
      file: path.relative(project.superwallDir, file),
      ...finding,
    })),
  );
}

export function formatTokenFinding(finding: TokenFinding): string {
  const tokens = finding.tokens.map((token) => `var(${token})`).join(" or ");
  return `${finding.file}:${finding.line} hard-codes ${finding.literal}, which the design system holds as ${tokens}. Use the token so a design-system change reaches it.`;
}
