import { describe, expect, it } from "vitest";
import {
  hostAttributes,
  injectPlatformLayer,
  PLATFORM_STYLESHEET_URL,
  renderDocument,
} from "../../src/document";
import { injectWebviewSimulation } from "../../src/preview/webview";

const doc = (config = {}) =>
  renderDocument({ title: "plus-upgrade", config, entry: "./entry.jsx" });

const STATIC = 'data-sw-generation="5" data-sw-scroll="true" data-sw-presentation="fullscreen"';

describe("renderDocument", () => {
  it("stamps document semantics on <html> so live.css rules can match", () => {
    expect(doc()).toContain(`<html ${STATIC}>`);
    expect(doc({ scrollEnabled: false })).toContain('data-sw-scroll="false"');
  });

  it("stamps the presentation so the insets know where the page starts", () => {
    expect(doc({ presentation: { style: "modal" } })).toContain('data-sw-presentation="modal"');
    expect(doc({ presentation: { style: "drawer" } })).toContain('data-sw-presentation="drawer"');
    expect(doc({ presentation: { style: "popup" } })).toContain('data-sw-presentation="popup"');
    expect(doc({ presentation: { style: "push" } })).toContain('data-sw-presentation="fullscreen"');
    expect(doc({ presentation: { style: "noAnimation" } })).toContain(
      'data-sw-presentation="fullscreen"',
    );
  });

  it("stamps the light background on <html> only when configured", () => {
    expect(doc()).not.toContain("background-color");
    expect(doc({ background: "#000000" })).toContain(
      `<html ${STATIC} style="background-color:#000000">`,
    );
    expect(doc({ background: { light: "#ffffff", dark: "#0d0f12" } })).toContain(
      'style="background-color:#ffffff"',
    );
  });

  it("carries nothing but the paywall — no framework styling", () => {
    const html = doc();
    expect(html).toContain('<script type="module" src="./entry.jsx">');
    expect(html).toContain('<div id="root">');
    // Any <style> here would silently diverge preview from production.
    expect(html).not.toContain("<style");
  });
});

describe("hostAttributes", () => {
  it("describes the host the paywall is running in, for the inset floors", () => {
    expect(
      hostAttributes({ platform: "iOS", interfaceType: "iphone", deviceModel: "iPhone18,3" }),
    ).toEqual({
      "data-sw-platform": "ios",
      "data-sw-idiom": "phone",
      "data-sw-cutout": "island",
    });
    expect(hostAttributes({ platform: "Android", deviceModel: "Pixel 10" })).toEqual({
      "data-sw-platform": "android",
      "data-sw-idiom": undefined,
      "data-sw-cutout": undefined,
    });
  });

  it("leaves every attribute off for a host that has said nothing", () => {
    expect(hostAttributes({})).toEqual({
      "data-sw-platform": undefined,
      "data-sw-idiom": undefined,
      "data-sw-cutout": undefined,
    });
  });
});

describe("injectPlatformLayer", () => {
  it("puts the stylesheet first in <head> so paywall styles still win", () => {
    const html = injectPlatformLayer(doc(), PLATFORM_STYLESHEET_URL);
    const link = html.indexOf(PLATFORM_STYLESHEET_URL);
    expect(link).toBeGreaterThan(html.indexOf("<head>"));
    expect(link).toBeLessThan(html.indexOf("<title>"));
  });

  it("falls back for documents without a head or html element", () => {
    expect(injectPlatformLayer("<html><body>x</body></html>", "/live.css")).toContain(
      '<head><link rel="stylesheet" href="/live.css"></head>',
    );
    expect(injectPlatformLayer("<p>bare</p>", "/live.css")).toBe(
      '<link rel="stylesheet" href="/live.css"><p>bare</p>',
    );
  });
});

describe("preview parity", () => {
  it("differs from a served snapshot only by the webview simulation", () => {
    const served = injectPlatformLayer(doc(), PLATFORM_STYLESHEET_URL);
    const preview = injectWebviewSimulation(served);

    const withoutSimulation = preview
      .replace(/<style data-superwall-preview="webview">[\s\S]*?<\/style>/, "")
      .replace(", maximum-scale=1", "");
    expect(withoutSimulation).toBe(served);
    // The simulation is scoped to browser chrome, never paywall styling.
    expect(preview).toContain("scrollbar-width: none");
    // Pinch-zoom is disabled in previews only; the served document keeps its viewport.
    expect(preview).toContain("maximum-scale=1");
    expect(served).not.toContain("maximum-scale");
  });
});
