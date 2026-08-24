import { describe, expect, it } from "vitest";
import { injectWebviewSimulation } from "../../src/preview/webview";

const head = (meta: string) => `<html><head>${meta}</head><body></body></html>`;

describe("injectWebviewSimulation", () => {
  it("locks zoom in previews without touching the published document", () => {
    const html = injectWebviewSimulation(
      head(`<meta name="viewport" content="width=device-width, initial-scale=1" />`),
    );
    expect(html).toContain(
      `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />`,
    );
    expect(html).toContain('data-superwall-preview="webview"');
  });

  it("leaves a viewport that already caps scale alone", () => {
    const meta = `<meta name="viewport" content="width=device-width, maximum-scale=1" />`;
    expect(injectWebviewSimulation(head(meta))).toContain(meta);
  });

  it("still injects styles when there is no viewport tag", () => {
    const html = injectWebviewSimulation(head(""));
    expect(html).toContain('data-superwall-preview="webview"');
    expect(html).not.toContain("maximum-scale");
  });
});
