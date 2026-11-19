import { describe, expect, it } from "vitest";
import { injectWebviewSimulation } from "../../src/preview/webview";

const head = (meta: string) => `<html><head>${meta}</head><body></body></html>`;

describe("injectWebviewSimulation", () => {
  it("adds the webview styles and leaves the viewport as the document has it", () => {
    const meta = `<meta name="viewport" content="width=device-width, initial-scale=1" />`;
    const html = injectWebviewSimulation(head(meta));
    expect(html).toContain(meta);
    expect(html).toContain('data-superwall-preview="webview"');
  });
});
