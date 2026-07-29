import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Link, PaywallRouter, type PaywallRoute } from "../../src/navigation/index";

const BASE = "https://user-content.test/user-content/hl/42";
const hero = `${BASE}/aaaa.png`;
const clip = `${BASE}/bbbb.mp4`;
const shared = `${BASE}/cccc.woff2`;
const terms = `${BASE}/dddd.png`;

const Home = () => <Link href="/offer">Go to offer</Link>;
const Offer = () => <Link href="/terms">Go to terms</Link>;
const Terms = () => <span>terms page</span>;

const routes: PaywallRoute[] = [
  { path: "/", Component: Home },
  { path: "/offer", Component: Offer },
  { path: "/terms", Component: Terms },
];

const withMap = (map: unknown): void => {
  const tag = document.createElement("script");
  tag.type = "application/json";
  tag.id = "sw-route-assets";
  tag.textContent = typeof map === "string" ? map : JSON.stringify(map);
  document.head.appendChild(tag);
};

const MAP = {
  "*": [{ url: shared, as: "font" }],
  "/": [{ url: hero, as: "image" }],
  "/offer": [{ url: clip, as: "video" }],
  "/terms": [{ url: terms, as: "image" }],
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

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.querySelectorAll("#sw-route-assets, link[rel=preload]").forEach((n) => n.remove());
});

describe("route asset prefetching", () => {
  it("warms the shared bucket, the current route, and the one after it on mount", () => {
    trackImages();
    withMap(MAP);
    render(<PaywallRouter routes={routes} />);

    expect(images).toEqual([hero]);
    expect(preloaded()).toEqual([
      { href: shared, as: "font", crossOrigin: "anonymous" },
      { href: clip, as: "video", crossOrigin: null },
    ]);
  });

  it("warms the next route on navigation, and never the same asset twice", () => {
    trackImages();
    withMap(MAP);
    render(<PaywallRouter routes={routes} />);
    images = [];

    fireEvent.click(screen.getByText("Go to offer"));

    expect(images).toEqual([terms]);
    expect(preloaded().map((link) => link.href)).toEqual([shared, clip]);

    fireEvent.click(screen.getByText("Go to terms"));
    expect(images).toEqual([terms]);
  });

  it("never uses fetch or rel=prefetch — the serve-time CSP and the audit forbid both", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    trackImages();
    withMap(MAP);

    render(<PaywallRouter routes={routes} />);
    fireEvent.click(screen.getByText("Go to offer"));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.head.querySelectorAll("link[rel=prefetch]")).toHaveLength(0);
  });

  it("does nothing at all when the snapshot inlined every asset", () => {
    trackImages();
    render(<PaywallRouter routes={routes} />);
    fireEvent.click(screen.getByText("Go to offer"));

    expect(images).toEqual([]);
    expect(preloaded()).toEqual([]);
  });

  it("survives a map that is missing, malformed, or full of junk entries", () => {
    trackImages();
    withMap("{ not json");
    const { unmount } = render(<PaywallRouter routes={routes} />);
    expect(images).toEqual([]);
    unmount();

    document.getElementById("sw-route-assets")?.remove();
    withMap({ "/": [{ url: hero, as: "script" }, { url: 7, as: "image" }, null, "nope"] });
    render(<PaywallRouter routes={routes} />);

    expect(images).toEqual([]);
    expect(preloaded()).toEqual([]);
  });

  it("warms nothing extra for a route that is not in the router's list", () => {
    trackImages();
    withMap(MAP);
    render(<PaywallRouter routes={routes} initialPath="/unknown" />);

    expect(images).toEqual([]);
    expect(preloaded()).toEqual([{ href: shared, as: "font", crossOrigin: "anonymous" }]);
  });
});
