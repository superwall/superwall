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

const state = (selector: string): string | undefined =>
  /\[data-sw-state="([a-z]+)"\]/.exec(selector)?.[1];

const direction = (selector: string): string | undefined =>
  /\[data-sw-direction="([a-z]+)"\]/.exec(selector)?.[1];

describe("routes.css keeps each transition's layers coherent", () => {
  it("animates exactly one layer per direction for fade", () => {
    // Two half-faded layers composite to less than full opacity, flashing the
    // container background through. Only the incoming (forward) or the
    // outgoing (back) may animate — never both.
    for (const going of ["forward", "back"]) {
      const moving = forTransition("fade").filter((rule) => direction(rule.selector) === going);
      expect(moving).toHaveLength(1);
    }

    expect(
      forTransition("fade").map((rule) => [direction(rule.selector), state(rule.selector)]),
    ).toEqual([
      ["forward", "active"],
      ["back", "exiting"],
    ]);
  });

  it("qualifies every fade rule by direction, so neither can apply to both", () => {
    for (const rule of forTransition("fade")) {
      expect(direction(rule.selector)).toBeDefined();
    }
  });

  it("moves both layers together for push and slide, which is what makes them read as one gesture", () => {
    for (const name of ["push", "slide"]) {
      const forward = forTransition(name).filter((rule) => direction(rule.selector) === "forward");
      const states = forward.map((rule) => state(rule.selector));
      expect(states).toContain("active");
      expect(states.some((one) => one === "behind" || one === "exiting")).toBe(true);
    }
  });

  it("never animates a route buried more than one deep", () => {
    for (const rule of animationRules()) {
      expect(state(rule.selector)).not.toBe("below");
    }
  });

  it("only animates while a transition is in flight", () => {
    for (const rule of animationRules()) {
      expect(rule.selector.replace(/\s+/g, "")).toContain(":not([data-sw-settled])");
    }
  });

  it("gives fade its own duration and easing, since opacity has no momentum", () => {
    expect(css).toMatch(/\[data-sw-transition="fade"\][^{]*\{[^}]*--sw-transition-fade/s);
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
