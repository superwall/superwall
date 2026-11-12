// @vitest-environment node
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aliasColonPaths, colonAliasPlugin, colonAncestor } from "../../src/preview/alias";

let scratch: string;
let base: string;

beforeEach(() => {
  scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "superwall-alias-")));
  base = path.join(scratch, "links");
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

const folder = (...parts: string[]): string => {
  const dir = path.join(scratch, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

describe("colonAncestor", () => {
  it("returns the deepest folder whose name contains a colon", () => {
    expect(colonAncestor("/Users/me/a:b/c:d/proj/file.ts")).toBe("/Users/me/a:b/c:d");
    expect(colonAncestor("/Users/me/:Documents:Paywalls/superwall")).toBe(
      "/Users/me/:Documents:Paywalls",
    );
  });

  it("returns nothing for a path without a colon", () => {
    expect(colonAncestor("/Users/me/Paywalls/superwall")).toBeUndefined();
  });
});

describe("aliasColonPaths", () => {
  it("creates no link and keeps paths as they are when nothing has a colon", () => {
    const plain = folder("plain", "proj");
    const aliases = aliasColonPaths([plain], base);

    expect(aliases.entries).toEqual([]);
    expect(aliases.toAlias(plain)).toBe(plain);
    expect(fs.existsSync(base)).toBe(false);
  });

  it("links the colon folder under a colon-free name and maps paths inside it", () => {
    const colon = folder(":Documents:Paywalls");
    const proj = folder(":Documents:Paywalls", "superwall");
    const aliases = aliasColonPaths([proj], base);

    const [entry] = aliases.entries;
    expect(entry?.real).toBe(colon);
    expect(entry?.alias).not.toContain(":");
    expect(path.basename(entry!.alias)).toBe("-Documents-Paywalls");
    expect(fs.realpathSync(entry!.alias)).toBe(colon);

    const file = path.join(proj, "paywalls", "demo", "config.ts");
    expect(aliases.toAlias(file)).toBe(
      path.join(entry!.alias, "superwall/paywalls/demo/config.ts"),
    );
    expect(aliases.toAlias(colon)).toBe(entry!.alias);
  });

  it("covers colons in several folders with one link to the deepest", () => {
    const proj = folder("a:b", "c:d", "proj");
    const aliases = aliasColonPaths([proj], base);

    expect(aliases.entries).toHaveLength(1);
    expect(aliases.toAlias(proj)).not.toContain(":");
    expect(fs.realpathSync(aliases.toAlias(proj))).toBe(proj);
  });

  it("maps paths reached through a symlink to the colon folder's real path", () => {
    folder("real", "a:b", "proj");
    fs.symlinkSync(path.join(scratch, "real"), path.join(scratch, "via"), "dir");
    const viaProj = path.join(scratch, "via", "a:b", "proj");
    const aliases = aliasColonPaths([viaProj], base);

    const expected = path.join(aliases.entries[0]!.alias, "proj");
    expect(aliases.toAlias(viaProj)).toBe(expected);
    expect(aliases.toAlias(path.join(scratch, "real", "a:b", "proj"))).toBe(expected);
  });

  it("links each distinct colon folder once and prefers the deepest match", () => {
    const outer = folder("x:y", "one");
    const inner = folder("x:y", "two", "p:q", "proj");
    const aliases = aliasColonPaths([outer, inner, outer], base);

    expect(aliases.entries).toHaveLength(2);
    expect(fs.realpathSync(aliases.toAlias(inner))).toBe(inner);
    expect(path.basename(path.dirname(aliases.toAlias(inner)))).toBe("p-q");
    expect(fs.realpathSync(aliases.toAlias(outer))).toBe(outer);
  });

  it("reuses the same link on the next start", () => {
    const proj = folder("a:b", "proj");
    const first = aliasColonPaths([proj], base).entries[0]!;
    const stat = fs.lstatSync(first.alias);
    const second = aliasColonPaths([proj], base).entries[0]!;

    expect(second.alias).toBe(first.alias);
    expect(fs.lstatSync(second.alias).ino).toBe(stat.ino);
  });

  it("replaces a stale link that points somewhere else", () => {
    const proj = folder("a:b", "proj");
    const { alias } = aliasColonPaths([proj], base).entries[0]!;
    fs.unlinkSync(alias);
    fs.symlinkSync(folder("elsewhere"), alias, "dir");

    aliasColonPaths([proj], base);

    expect(fs.realpathSync(alias)).toBe(path.join(scratch, "a:b"));
  });

  it("stops with an error naming the folder when the link cannot be created", () => {
    const proj = folder("a:b", "proj");
    const blocked = path.join(scratch, "blocked");
    fs.writeFileSync(blocked, "");

    expect(() => aliasColonPaths([proj], path.join(blocked, "links"))).toThrow(
      new RegExp(`superwall dev cannot serve ${path.join(scratch, "a:b")}: Vite refuses paths`),
    );
  });

  it("stops with an error naming the folder when the colon folder does not exist", () => {
    const missing = path.join(scratch, "gone:here", "proj");

    expect(() => aliasColonPaths([missing], base)).toThrow(
      `superwall dev could not read ${path.join(scratch, "gone:here")}`,
    );
  });
});

describe("colonAliasPlugin", () => {
  type Resolved = { id: string; external?: boolean } | null;
  const resolveWith = async (aliases: ReturnType<typeof aliasColonPaths>, resolved: Resolved) => {
    const plugin = colonAliasPlugin(aliases);
    const hook = plugin.resolveId as unknown as (
      this: { resolve: () => Promise<Resolved> },
      source: string,
      importer: string | undefined,
      options: object,
    ) => Promise<Resolved>;
    return hook.call({ resolve: async () => resolved }, "./x", undefined, {});
  };

  it("maps a resolved id inside the colon folder back onto the link, keeping its query", async () => {
    const proj = folder("a:b", "proj");
    const aliases = aliasColonPaths([proj], base);
    const real = path.join(proj, "styles.css");

    const result = await resolveWith(aliases, { id: `${real}?direct` });

    expect(result?.id).toBe(`${aliases.toAlias(real)}?direct`);
  });

  it("leaves ids outside the colon folder, external ids and misses alone", async () => {
    const aliases = aliasColonPaths([folder("a:b", "proj")], base);
    const outside = { id: path.join(scratch, "elsewhere.ts") };
    const external = { id: path.join(scratch, "a:b", "proj", "x.ts"), external: true };

    expect(await resolveWith(aliases, outside)).toBe(outside);
    expect(await resolveWith(aliases, external)).toBe(external);
    expect(await resolveWith(aliases, null)).toBeNull();
  });

  it("does nothing when no path has a colon", async () => {
    const aliases = aliasColonPaths([folder("plain")], base);

    expect(await resolveWith(aliases, { id: "/anything" })).toBeNull();
  });
});
