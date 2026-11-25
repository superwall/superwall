import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaywallRouter, type Entry, type RouteMap } from "../../src/navigation/index";
import { createWrapper } from "../helpers";

const BASE = "https://user-content.test/user-content/hl/42";
const hero = `${BASE}/aaaa.png`;
const clip = `${BASE}/bbbb.mp4`;
const shared = `${BASE}/cccc.woff2`;
const terms = `${BASE}/dddd.png`;

const Blank = () => null;

const routes: RouteMap = {
  index: { default: Blank },
  offer: { default: Blank },
  terms: { default: Blank },
};

const mount = (entry?: Entry) => {
  const Wrapper = createWrapper();
  return render(
    <Wrapper>
      <PaywallRouter routes={routes} entry={entry} />
    </Wrapper>,
  );
};

const withMap = (map: unknown): void => {
  const tag = document.createElement("script");
  tag.type = "application/json";
  tag.id = "sw-route-assets";
  tag.textContent = typeof map === "string" ? map : JSON.stringify(map);
  document.head.appendChild(tag);
};

const MAP = {
  "*": [{ url: shared, as: "font" }],
  index: [{ url: hero, as: "image" }],
  offer: [{ url: clip, as: "video" }],
  terms: [{ url: terms, as: "image" }],
};

const preloaded = () =>
  [...document.head.querySelectorAll("link[rel=preload]")].map((link) => ({
    href: link.getAttribute("href"),
    as: link.getAttribute("as"),
    crossOrigin: link.getAttribute("crossorigin"),
  }));

let images: string[] = [];

const trackImages = () => {
  images = [];
  class TrackedImage {
    set src(value: string) {
      images.push(value);
    }
  }
  vi.stubGlobal("Image", TrackedImage);
};

const teleportTo = (route: string) => {
  (window as typeof window & { __SW_TELEPORT__?: unknown }).__SW_TELEPORT__ = {
    id: "tp_1",
    route,
  };
};

const idle = () => act(() => vi.advanceTimersByTime(500));

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  vi.useFakeTimers();
  vi.stubGlobal("requestIdleCallback", undefined);
});

afterEach(() => {
  delete (window as typeof window & { __SW_TELEPORT__?: unknown }).__SW_TELEPORT__;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.head.querySelectorAll("#sw-route-assets, link[rel=preload]").forEach((n) => n.remove());
});

describe("screen asset prefetching", () => {
  it("warms the shared bucket and the initial screen on mount, the rest on idle", () => {
    trackImages();
    withMap(MAP);
    mount();

    expect(images).toEqual([hero]);
    expect(preloaded()).toEqual([{ href: shared, as: "font", crossOrigin: "anonymous" }]);

    idle();

    expect(images).toEqual([hero, terms]);
    expect(preloaded().map((link) => link.href)).toEqual([shared, clip]);
  });

  it("never warms the same asset twice", () => {
    trackImages();
    withMap({
      ...MAP,
      offer: [
        { url: hero, as: "image" },
        { url: clip, as: "video" },
      ],
    });
    mount();
    idle();
    idle();

    expect(images.filter((url) => url === hero)).toHaveLength(1);
    expect(preloaded().filter((link) => link.href === clip)).toHaveLength(1);
  });

  it("never uses fetch or rel=prefetch — the serve-time CSP and the audit forbid both", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    trackImages();
    withMap(MAP);

    mount();
    idle();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.head.querySelectorAll("link[rel=prefetch]")).toHaveLength(0);
  });

  it("does nothing at all when the snapshot inlined every asset", () => {
    trackImages();
    mount();
    idle();

    expect(images).toEqual([]);
    expect(preloaded()).toEqual([]);
  });

  it("survives a map that is missing, malformed, or full of junk entries", () => {
    trackImages();
    withMap("{ not json");
    const { unmount } = mount();
    idle();
    expect(images).toEqual([]);
    unmount();

    document.getElementById("sw-route-assets")?.remove();
    withMap({ index: [{ url: hero, as: "script" }, { url: 7, as: "image" }, null, "nope"] });
    mount();
    idle();

    expect(images).toEqual([]);
    expect(preloaded()).toEqual([]);
  });

  it("cancels the idle pass when the paywall unmounts first", () => {
    trackImages();
    withMap(MAP);
    const { unmount } = mount();
    unmount();
    idle();

    expect(images).toEqual([hero]);
    expect(preloaded().map((link) => link.href)).toEqual([shared]);
  });
});

describe("the stack the paywall opens on", () => {
  it("warms the routes of a ?sw_nav= stack on mount instead of index", () => {
    trackImages();
    withMap(MAP);
    window.history.replaceState({}, "", "/?sw_nav=terms");
    mount();

    expect(images).toEqual([terms]);
    expect(preloaded().map((link) => link.href)).toEqual([shared]);

    idle();

    expect(images).toEqual([terms, hero]);
    expect(preloaded().map((link) => link.href)).toEqual([shared, clip]);
  });

  it("warms every route of a deeper ?sw_nav= stack on mount", () => {
    trackImages();
    withMap(MAP);
    window.history.replaceState({}, "", "/?sw_nav=index,offer");
    mount();

    expect(images).toEqual([hero]);
    expect(preloaded().map((link) => link.href)).toEqual([shared, clip]);
  });

  it("warms the stack entry() chose on mount instead of index", async () => {
    trackImages();
    withMap(MAP);
    mount(() => ["offer", "terms"]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(images).toEqual([terms]);
    expect(preloaded().map((link) => link.href)).toEqual([shared, clip]);

    idle();

    expect(images).toEqual([terms, hero]);
  });
});

describe("a teleported page", () => {
  it("warms only the route it boots on, without the shared bucket or the idle pass", () => {
    trackImages();
    withMap(MAP);
    teleportTo("terms");
    mount();

    expect(window.location.search).toContain("sw_nav=terms");
    expect(images).toEqual([terms]);
    expect(preloaded()).toEqual([]);

    idle();

    expect(images).toEqual([terms]);
    expect(preloaded()).toEqual([]);
  });

  it("warms every route of the stack it boots on", () => {
    trackImages();
    withMap(MAP);
    teleportTo("offer");
    window.history.replaceState({}, "", "/?sw_nav=index,offer");
    mount();
    idle();

    expect(images).toEqual([hero]);
    expect(preloaded().map((link) => link.href)).toEqual([clip]);
  });
});

describe("a route-asset map with entries that are not lists", () => {
  it("warms the lists it can read and ignores the rest", () => {
    trackImages();
    withMap({ index: [{ url: hero, as: "image" }], offer: "nope", terms: 7 });
    mount();
    expect(images).toEqual([hero]);
    expect(preloaded()).toEqual([]);
  });
});

describe("onNavigate", () => {
  it("names each route the paywall lands on", () => {
    const navigated: string[] = [];
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <PaywallRouter routes={routes} onNavigate={(route) => navigated.push(route)} />
      </Wrapper>,
    );
    expect(navigated).toEqual(["index"]);
  });
});

describe("a route-asset payload that is not a map", () => {
  it("warms nothing at all", () => {
    trackImages();
    withMap("null");
    mount();
    expect(images).toEqual([]);
    expect(preloaded()).toEqual([]);
  });
});
