import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Plugin } from "vite";

export type ColonAlias = { real: string; alias: string };

export type ColonAliases = {
  readonly entries: readonly ColonAlias[];
  toAlias: (file: string) => string;
};

const isInside = (dir: string, file: string): boolean =>
  file === dir || file.startsWith(dir + path.sep);

export const colonAncestor = (file: string): string | undefined => {
  const parts = path.resolve(file).split(path.sep);
  for (let index = parts.length - 1; index > 0; index--) {
    if (parts[index]?.includes(":")) return parts.slice(0, index + 1).join(path.sep);
  }
  return undefined;
};

const aliasBase = (): string =>
  path.join(fs.realpathSync(os.tmpdir()), `superwall-dev-${os.userInfo().uid}`);

const claimPrivate = (base: string): void => {
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(base);
  if (!stat.isDirectory() || stat.uid !== os.userInfo().uid || (stat.mode & 0o077) !== 0) {
    throw new Error(`${base} must be a folder only you can write to`);
  }
};

const linkFor = (dir: string, base: string): ColonAlias => {
  let real: string;
  try {
    real = fs.realpathSync(dir);
  } catch (error) {
    throw new Error(`superwall dev could not read ${dir}: ${(error as Error).message}`, {
      cause: error,
    });
  }
  const hash = createHash("sha256").update(real).digest("hex").slice(0, 12);
  const alias = path.join(base, hash, path.basename(real).replaceAll(":", "-"));
  try {
    claimPrivate(base);
    const current = fs.lstatSync(alias, { throwIfNoEntry: false });
    if (current?.isSymbolicLink() && fs.readlinkSync(alias) === real) return { real, alias };
    if (current) fs.rmSync(alias, { recursive: false, force: true });
    fs.mkdirSync(path.dirname(alias), { recursive: true });
    fs.symlinkSync(real, alias, "dir");
  } catch (error) {
    throw new Error(
      `superwall dev cannot serve ${dir}: Vite refuses paths containing ":", and the colon-free link ${alias} could not be created (${(error as Error).message}).`,
      { cause: error },
    );
  }
  return { real, alias };
};

export const aliasColonPaths = (
  files: readonly string[],
  base: string = aliasBase(),
): ColonAliases => {
  const entries: ColonAlias[] = [];
  for (const file of files) {
    const dir = colonAncestor(file);
    if (dir === undefined) continue;
    const link = linkFor(dir, base);
    if (!entries.some((entry) => entry.real === link.real)) entries.push(link);
  }
  entries.sort((a, b) => b.real.length - a.real.length);

  const toAlias = (file: string): string => {
    if (file.startsWith("\0") || !path.isAbsolute(file)) return file;
    const resolved = path.resolve(file);
    const candidates = [resolved];
    const dir = colonAncestor(resolved);
    if (dir !== undefined && fs.existsSync(dir)) {
      candidates.push(path.join(fs.realpathSync(dir), path.relative(dir, resolved)));
    }
    for (const candidate of candidates) {
      for (const entry of entries) {
        if (isInside(entry.real, candidate)) {
          return path.join(entry.alias, path.relative(entry.real, candidate));
        }
      }
    }
    return file;
  };

  return { entries, toAlias };
};

export const colonAliasPlugin = (
  aliases: ColonAliases,
  viteClientFiles: readonly string[] = [],
): Plugin => {
  const clientFiles = new Map<string, string>();
  for (const real of viteClientFiles) {
    const aliased = aliases.toAlias(real);
    if (aliased !== real) clientFiles.set(aliased, real);
  }
  let clientInject: Plugin | undefined;
  return {
    name: "superwall:colon-alias",
    enforce: "pre",
    configResolved(config) {
      clientInject = config.plugins.find((plugin) => plugin.name === "vite:client-inject");
    },
    async resolveId(source, importer, options) {
      if (aliases.entries.length === 0) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved || resolved.external) return resolved;
      const [file, query] = splitQuery(resolved.id);
      const aliased = aliases.toAlias(file);
      return aliased === file ? resolved : { ...resolved, id: aliased + query };
    },
    async transform(code, id) {
      const real = clientFiles.get(splitQuery(id)[0]);
      const inject = clientInject?.transform;
      if (real === undefined || inject === undefined) return null;
      const handler = typeof inject === "function" ? inject : inject.handler;
      return handler.call(this, code, real);
    },
  };
};

const splitQuery = (id: string): [string, string] => {
  const index = id.indexOf("?");
  return index === -1 ? [id, ""] : [id.slice(0, index), id.slice(index)];
};
