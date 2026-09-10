import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopBar } from "../../src/components/chrome/TopBar";
import { StudioHostProvider, type StudioMode } from "../../src/lib/studio-host";

afterEach(cleanup);

const mount = (home: { href: string; navigate: () => void }, mode: StudioMode = "local") =>
  render(
    <StudioHostProvider mode={mode} home={home}>
      <TopBar title="pro" />
    </StudioHostProvider>,
  );

const logo = () => screen.getByRole("link");

describe("the studio's home link", () => {
  it("handles a plain click itself, without leaving the page", () => {
    const navigate = vi.fn();
    mount({ href: "/", navigate });

    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    logo().dispatchEvent(event);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("points at the host's home, so the browser opens the right page in a new tab", () => {
    // The dashboard's studio lives under /:org/:app/paywalls/:id/studio, where
    // the origin root is not the list the logo goes back to.
    mount({ href: "/3642/52516/paywalls", navigate: () => {} }, "hosted");

    expect(logo().getAttribute("href")).toBe("/3642/52516/paywalls");
  });

  it("follows the device studio home, not the desktop one", () => {
    mount({ href: "/device", navigate: () => {} }, "device");

    expect(logo().getAttribute("href")).toBe("/device");
  });

  for (const [name, init] of [
    ["a middle click", { button: 1 }],
    ["cmd-click", { button: 0, metaKey: true }],
    ["ctrl-click", { button: 0, ctrlKey: true }],
    ["shift-click", { button: 0, shiftKey: true }],
  ] as const) {
    it(`leaves ${name} to the browser`, () => {
      const navigate = vi.fn();
      mount({ href: "/paywalls", navigate });

      // Read the flag once the bar's handler has had it, then stop the event:
      // an un-prevented click on a real href sends jsdom off navigating, which
      // it cannot do and reports asynchronously, after the test has finished.
      let prevented: boolean | undefined;
      document.addEventListener(
        "click",
        (event) => {
          prevented = event.defaultPrevented;
          event.preventDefault();
        },
        { once: true },
      );
      logo().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));

      expect(navigate).not.toHaveBeenCalled();
      expect(prevented).toBe(false);
    });
  }

  it("refuses to render outside a host, rather than guessing at a home", () => {
    expect(() => render(<TopBar title="pro" />)).toThrow(/StudioHostProvider/);
  });
});
