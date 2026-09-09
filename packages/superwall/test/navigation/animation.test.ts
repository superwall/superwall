import { afterEach, describe, expect, it, vi } from "vitest";
import {
  animationMs,
  freeze,
  longestAnimationMs,
  milliseconds,
  stillness,
  thaw,
} from "../../src/navigation/animation";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

const styled = (style: Partial<CSSStyleDeclaration>, animations = 1) => {
  const element = document.createElement("div");
  Object.assign(element, {
    getAnimations: () => Array.from({ length: animations }, () => ({})),
  });
  vi.stubGlobal(
    "getComputedStyle",
    () =>
      ({
        animationName: "none",
        animationDuration: "0s",
        animationDelay: "0s",
        transform: "none",
        filter: "none",
        opacity: "1",
        ...style,
      }) as CSSStyleDeclaration,
  );
  return element;
};

describe("milliseconds", () => {
  it("reads seconds and milliseconds, and treats unparseable values as zero", () => {
    expect(milliseconds("0.3s")).toEqual([300]);
    expect(milliseconds("200ms")).toEqual([200]);
    expect(milliseconds("0.3s, 200ms")).toEqual([300, 200]);
    expect(milliseconds("initial")).toEqual([0]);
  });
});

describe("animationMs", () => {
  it("is zero when nothing is animating", () => {
    expect(animationMs(styled({ animationName: "none" }))).toBe(0);
    expect(animationMs(styled({ animationName: "" }))).toBe(0);
  });

  it("takes the longest duration plus delay across parallel animations", () => {
    const element = styled({
      animationName: "slide-in, fade-in",
      animationDuration: "0.3s, 100ms",
      animationDelay: "0s, 500ms",
    });
    expect(animationMs(element)).toBe(600);
  });

  it("cycles shorter duration and delay lists, as CSS does", () => {
    const element = styled({
      animationName: "a, b, c",
      animationDuration: "100ms, 400ms",
      animationDelay: "0s",
    });
    expect(animationMs(element)).toBe(400);
  });
});

describe("longestAnimationMs", () => {
  it("measures every layer, and is zero without a container", () => {
    const container = document.createElement("div");
    container.append(styled({ animationName: "slide", animationDuration: "250ms" }));
    container.append(document.createElement("div"));
    expect(longestAnimationMs(container)).toBe(250);
    expect(longestAnimationMs(null)).toBe(0);
  });
});

describe("freeze and thaw", () => {
  it("records where a running layer sits, then clears it", () => {
    const container = document.createElement("div");
    const child = styled({
      transform: "matrix(1, 0, 0, 1, 40, 0)",
      filter: "blur(2px)",
      opacity: "0.5",
    });
    container.append(child);

    freeze(container);
    expect(child.style.getPropertyValue("--sw-from-transform")).toBe("matrix(1, 0, 0, 1, 40, 0)");
    expect(child.style.getPropertyValue("--sw-from-filter")).toBe("blur(2px)");
    expect(child.style.getPropertyValue("--sw-from-opacity")).toBe("0.5");

    thaw(container);
    expect(child.style.getPropertyValue("--sw-from-transform")).toBe("");
  });

  it("clears a layer that is not animating instead of pinning it", () => {
    const container = document.createElement("div");
    const child = styled({ transform: "none" }, 0);
    child.style.setProperty("--sw-from-opacity", "0.2");
    container.append(child);

    freeze(container);
    expect(child.style.getPropertyValue("--sw-from-opacity")).toBe("");
  });

  it("clears a layer whose element cannot report animations", () => {
    const container = document.createElement("div");
    const child = document.createElement("div");
    child.style.setProperty("--sw-from-opacity", "0.2");
    Object.assign(child, { getAnimations: undefined });
    container.append(child);

    freeze(container);
    expect(child.style.getPropertyValue("--sw-from-opacity")).toBe("");
  });

  it("ignores nodes that are not elements, and a missing container", () => {
    const container = document.createElement("div");
    container.append(document.createComment("held for later"));
    expect(() => {
      freeze(container);
      thaw(container);
      freeze(null);
      thaw(null);
    }).not.toThrow();
  });
});

describe("stillness", () => {
  it("is what the reduced-motion query says, and false where there is no query", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    expect(stillness()).toBe(true);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(stillness()).toBe(false);
    vi.stubGlobal("matchMedia", undefined);
    expect(stillness()).toBe(false);
  });
});
