import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src/navigation/routes.css"),
  "utf8",
);

/** The body of the prefers-reduced-motion guard, found by brace matching. */
const reducedMotionBlock = ((): string => {
  const at = css.indexOf("@media (prefers-reduced-motion: no-preference)");
  if (at === -1) throw new Error("routes.css no longer guards motion");
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error("unbalanced braces in routes.css");
})();

/** Every `animation-name:` rule, paired with the selector that applies it. */
const animationRules = (source = css): { selector: string; animation: string }[] => {
  const rules: { selector: string; animation: string }[] = [];
  const pattern = /([^{}]+)\{([^{}]*animation-name:[^{}]*)\}/g;
  for (const match of source.matchAll(pattern)) {
    const selector = match[1].replace(/\s+/g, " ").trim();
    const animation = /animation-name:\s*([^;]+)/.exec(match[2])?.[1].trim() ?? "";
    if (selector.startsWith("@")) continue;
    for (const one of selector.split(",")) rules.push({ selector: one.trim(), animation });
  }
  return rules;
};

const forTransition = (name: string) =>
  animationRules().filter((rule) => rule.selector.includes(`[data-sw-transition="${name}"]`));

const phase = (selector: string): string | undefined =>
  /\[data-sw-phase="([a-z]+)"\]/.exec(selector)?.[1];

const phasesOf = (name: string): (string | undefined)[] =>
  forTransition(name).map((rule) => phase(rule.selector));

describe("routes.css keeps each transition's layers coherent", () => {
  it("fades one layer at a time — it names enter and leave, never recede or return", () => {
    // Two half-faded layers ghost over each other and wash out, since both
    // sets of content stay partly visible at once. Only the arriving route
    // (enter) or the departing one (leave) may animate.
    expect(phasesOf("fade").toSorted()).toEqual(["enter", "leave"]);
  });

  it("moves both layers for push and slide, which is what makes them read as one gesture", () => {
    for (const name of ["push", "slide"]) {
      expect(phasesOf(name).toSorted()).toEqual(["enter", "leave", "recede", "return"]);
    }
  });

  it("names a phase on every animation rule, so none can leak across situations", () => {
    for (const rule of animationRules()) {
      expect(phase(rule.selector)).toBeDefined();
    }
  });

  it("uses only the four phases the router emits", () => {
    for (const rule of animationRules()) {
      expect(["enter", "recede", "leave", "return"]).toContain(phase(rule.selector));
    }
  });

  it("gives fade its own duration and easing, since opacity has no momentum", () => {
    expect(css).toMatch(
      /\[data-sw-transition="fade"\]\[data-sw-phase\][^{]*\{[^}]*--sw-transition-fade/s,
    );
    expect(css).toMatch(/--sw-ease-fade/);
  });

  it("declares every animation inside the prefers-reduced-motion guard", () => {
    const guarded = animationRules(reducedMotionBlock).map((rule) => rule.selector);

    expect(guarded.length).toBeGreaterThan(0);
    for (const rule of animationRules()) {
      expect(guarded).toContain(rule.selector);
    }
  });
});
