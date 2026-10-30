import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NotificationPreview, notificationWidth } from "../../src/components/NotificationPreview";

afterEach(cleanup);

const app = { name: "pulse", iconUrl: "https://example.com/icon.png" };
const notification = {
  title: "Your trial ends tomorrow",
  subtitle: "Pulse Pro",
  body: "Cancel any time before then and you won't be charged.",
};

const part = (name: string) => {
  const element = screen.getByTestId("notification-preview").querySelector(`[data-part="${name}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`no ${name}`);
  return element;
};

describe("NotificationPreview", () => {
  it("sits on a slice of the previewed screen, inset like a real banner", () => {
    expect(notificationWidth("iOS", 402)).toBe(374);
    expect(notificationWidth("iOS", 375)).toBe(347);
    expect(notificationWidth("Android", 412)).toBe(388);
    expect(notificationWidth("iOS", 10)).toBe(0);

    render(
      <NotificationPreview
        platform="iOS"
        screenWidth={402}
        app={app}
        notification={notification}
      />,
    );
    expect(screen.getByTestId("notification-preview").style.width).toBe("402px");
    expect(part("card").style.width).toBe("374px");
  });

  it("lays out iOS: title with now, subtitle on its own line, body clamped at 4 lines", () => {
    render(
      <NotificationPreview
        platform="iOS"
        screenWidth={402}
        app={app}
        notification={notification}
      />,
    );

    expect(
      screen
        .getByTestId("notification-preview")
        .querySelector("[data-platform]")
        ?.getAttribute("data-platform"),
    ).toBe("iOS");
    expect(part("title").textContent).toBe("Your trial ends tomorrow");
    expect(part("title").style.whiteSpace).toBe("nowrap");
    expect(part("title").parentElement?.textContent).toContain("now");
    expect(part("subtitle").textContent).toBe("Pulse Pro");
    expect(part("subtitle").style.fontWeight).toBe("600");
    expect(part("body").style.webkitLineClamp).toBe("4");
    expect(screen.getByTestId("notification-icon").style.borderRadius).toBe("8px");
  });

  it("lays out Android: app • subtitle • now, then title, body clamped at 2 lines", () => {
    render(
      <NotificationPreview
        platform="Android"
        screenWidth={412}
        app={app}
        notification={notification}
      />,
    );

    expect(part("header").textContent).toBe("pulse•Pulse Pro•now");
    expect(part("title").textContent).toBe("Your trial ends tomorrow");
    expect(part("body").style.webkitLineClamp).toBe("2");
    expect(screen.getByTestId("notification-icon").style.borderRadius).toBe("50%");
  });

  it("leaves the subtitle out when there is none", () => {
    const { rerender } = render(
      <NotificationPreview
        platform="iOS"
        screenWidth={402}
        app={app}
        notification={{ title: "Trial", body: "Ends soon" }}
      />,
    );
    expect(
      screen.getByTestId("notification-preview").querySelector('[data-part="subtitle"]'),
    ).toBeNull();

    rerender(
      <NotificationPreview
        platform="Android"
        screenWidth={412}
        app={app}
        notification={{ title: "Trial", body: "Ends soon" }}
      />,
    );
    expect(part("header").textContent).toBe("pulse•now");
  });

  it("falls back to the app's initial without an icon, or when it fails to load", () => {
    const { rerender } = render(
      <NotificationPreview
        platform="iOS"
        screenWidth={402}
        app={{ name: "pulse" }}
        notification={notification}
      />,
    );
    expect(screen.getByTestId("notification-icon-fallback").textContent).toBe("P");

    rerender(
      <NotificationPreview
        platform="iOS"
        screenWidth={402}
        app={app}
        notification={notification}
      />,
    );
    fireEvent.error(screen.getByTestId("notification-icon"));
    expect(screen.getByTestId("notification-icon-fallback").textContent).toBe("P");

    rerender(
      <NotificationPreview
        platform="Android"
        screenWidth={412}
        app={{ name: "  " }}
        notification={notification}
      />,
    );
    expect(screen.getByTestId("notification-icon-fallback").textContent).toBe("?");

    rerender(
      <NotificationPreview
        platform="iOS"
        screenWidth={402}
        app={{ name: "👩‍🚀 rocket" }}
        notification={notification}
      />,
    );
    expect(screen.getByTestId("notification-icon-fallback").textContent).toBe("👩‍🚀");
  });
});
