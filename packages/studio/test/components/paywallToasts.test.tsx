import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostDelegate } from "@superwall/host";
import {
  createStudioDelegate,
  PaywallToasts,
  useStudioDelegate,
  type ReminderTarget,
} from "../../src/components/PaywallToasts";

const product = { reference: "annual", productId: "pro_5999_year", variables: {} };

// sonner removes a dismissed toast 200ms later from a timer of its own. A test
// that ends inside that window leaves the timer to fire after jsdom is torn
// down ("window is not defined", seen on slow CI runners), so every test ends
// by dismissing its toasts and letting that timer run while the DOM still exists.
afterEach(async () => {
  await act(async () => {
    toast.dismiss();
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
});

const mount = () => {
  const delegate: HostDelegate = createStudioDelegate();
  render(<PaywallToasts surfaceKey="a/pro" />);
  return delegate;
};

const settle = () => act(async () => {});

const askFor = async (subject: string): Promise<HTMLElement> => {
  const pills = await screen.findAllByText(subject);
  const toast = pills.at(-1)?.closest("[data-sonner-toast]");
  if (!(toast instanceof HTMLElement)) throw new Error(`no toast asking about ${subject}`);
  return toast;
};

describe("PaywallToasts", () => {
  it("reports what the paywall asked of its host", async () => {
    const delegate = mount();
    await act(async () => {
      delegate.event({ event_name: "close" });
    });

    expect(await screen.findByText("close")).toBeDefined();
  });

  it("names what an action was for", async () => {
    const delegate = mount();
    await act(async () => {
      delegate.event({ event_name: "open_url", url: "https://superwall.com/terms" });
    });

    expect(await screen.findByText("https://superwall.com/terms")).toBeDefined();
  });

  it("says nothing for events a device would not act on", async () => {
    const delegate = mount();
    await act(async () => {
      delegate.event({ event_name: "haptic_feedback", haptic_type: "light" });
    });

    expect(screen.queryByText(/haptic/i)).toBeNull();
  });

  it("asks you to complete a purchase and reports the outcome", async () => {
    const delegate = mount();
    let outcome: string | undefined;
    await act(async () => {
      Promise.resolve(delegate.purchase(product)).then((value) => {
        outcome = value;
      });
    });
    expect(await screen.findByText("annual")).toBeDefined();

    fireEvent.click(await screen.findByRole("button", { name: "Complete" }));
    await settle();

    expect(outcome).toBe("completed");
    expect(await screen.findByText(/purchase completed/)).toBeDefined();
  });

  it("lets you abandon or fail a purchase, so a paywall has to handle both", async () => {
    const delegate = mount();
    const outcomes: string[] = [];
    await act(async () => {
      Promise.resolve(delegate.purchase(product)).then((value) => {
        outcomes.push(value);
      });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Abandon" }));
    await settle();

    const monthly = { reference: "monthly", productId: "pro_999_month", variables: {} };
    await act(async () => {
      Promise.resolve(delegate.purchase(monthly)).then((value) => {
        outcomes.push(value);
      });
    });
    fireEvent.click(within(await askFor("monthly")).getByRole("button", { name: "Fail" }));
    await settle();

    expect(outcomes).toEqual(["abandoned", "failed"]);
  });

  it("asks you whether a restore finds anything", async () => {
    const delegate = mount();
    let outcome: string | undefined;
    await act(async () => {
      Promise.resolve(delegate.restore()).then((value) => {
        outcome = value;
      });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));
    await settle();

    expect(outcome).toBe("restored");
    expect(await screen.findByText(/restored/)).toBeDefined();
  });

  it("grants or denies a permission on your say-so", async () => {
    const delegate = mount();
    const statuses: string[] = [];
    await act(async () => {
      Promise.resolve(delegate.permission("notification")).then((value) => {
        statuses.push(value);
      });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Grant" }));
    await settle();

    await act(async () => {
      Promise.resolve(delegate.permission("camera")).then((value) => {
        statuses.push(value);
      });
    });
    fireEvent.click(within(await askFor("camera")).getByRole("button", { name: "Deny" }));
    await settle();

    expect(statuses).toEqual(["granted", "denied"]);
  });

  it("answers a callback the app would normally resolve", async () => {
    const delegate = mount();
    let result: { status: string } | undefined;
    await act(async () => {
      Promise.resolve(delegate.callback("checkAccount", {})).then((value) => {
        result = value;
      });
    });
    expect(await screen.findByText("checkAccount")).toBeDefined();
    fireEvent.click(await screen.findByRole("button", { name: "Succeed" }));
    await settle();

    expect(result).toEqual({ status: "success" });
    expect(await screen.findByText(/succeeded/)).toBeDefined();
  });

  it("does nothing on its own for navigation and custom actions", () => {
    const delegate = mount();
    delegate.close();
    delegate.openUrl("https://superwall.com", "external");
    delegate.custom("data");
    delegate.customPlacement("upsell", {});
    expect(screen.queryByText(/superwall\.com/)).toBeNull();
  });
});

const preview = () => screen.findByTestId("notification-preview");

describe("a scheduled trial reminder", () => {
  const reminder = {
    event_name: "schedule_notification" as const,
    id: "pro_TRIAL_STARTED",
    type: "TRIAL_STARTED" as const,
    title: "Your trial ends tomorrow",
    subtitle: "Pulse Pro",
    body: "Keep Pro, or cancel in Settings.",
    delay: 6 * 24 * 60 * 60 * 1000,
  };

  it("previews the notification on the default iPhone, with when it fires", async () => {
    const delegate = mount();
    await act(async () => {
      delegate.event(reminder);
    });

    expect(await screen.findByText("Trial reminder scheduled")).toBeDefined();
    expect(screen.getByText("· in 6 days")).toBeDefined();
    const card = await preview();
    expect(card.querySelector("[data-platform]")?.getAttribute("data-platform")).toBe("iOS");
    expect(card.style.width).toBe("386px");
    expect(card.textContent).toContain("Your trial ends tomorrow");
    expect(card.textContent).toContain("Pulse Pro");
    expect(card.textContent).toContain("Keep Pro, or cancel in Settings.");
    expect(screen.queryByText("schedule_notification")).toBeNull();
  });

  it("draws it for the device being previewed, and as the app the host names", async () => {
    let target: ReminderTarget = {
      platform: "Android",
      screenWidth: 412,
      theme: "dark",
      app: { name: "Pulse" },
    };
    const delegate = createStudioDelegate(() => target);
    render(<PaywallToasts surfaceKey="a/pro" />);
    await act(async () => {
      delegate.event({ ...reminder, subtitle: undefined });
    });

    const card = await preview();
    expect(card.querySelector("[data-platform]")?.getAttribute("data-platform")).toBe("Android");
    expect(card.style.width).toBe("388px");
    expect(screen.getByTestId("notification-icon-fallback").textContent).toBe("P");

    target = { ...target, platform: "iOS", screenWidth: 375 };
    await act(async () => {
      delegate.event({ ...reminder, id: "next" });
    });
    await waitFor(() =>
      expect(
        screen.getAllByTestId("notification-preview").map((each) => each.style.width),
      ).toContain("359px"),
    );
  });

  it("stays until you dismiss it, and a repeat replaces it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const delegate = mount();
      await act(async () => {
        delegate.event(reminder);
        delegate.event({ ...reminder, title: "Trial ends soon" });
      });
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });

      expect(await screen.findByText("Trial ends soon")).toBeDefined();
      expect(screen.getAllByTestId("notification-preview")).toHaveLength(1);

      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(screen.queryByTestId("notification-preview")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("follows the target a hook-made delegate is given on each render", async () => {
    let delegate: HostDelegate | undefined;
    const Probe = ({ target }: { target?: ReminderTarget }) => {
      delegate = useStudioDelegate(target);
      return null;
    };
    const { rerender } = render(<Probe />);
    render(<PaywallToasts surfaceKey="a/pro" />);
    const first = delegate;
    await act(async () => {
      delegate?.event(reminder);
    });
    expect((await preview()).style.width).toBe("386px");

    rerender(
      <Probe
        target={{ platform: "Android", screenWidth: 360, theme: "light", app: { name: "x" } }}
      />,
    );
    expect(delegate).toBe(first);
    await act(async () => {
      delegate?.event({ ...reminder, id: "android" });
    });
    await waitFor(() =>
      expect(
        screen.getAllByTestId("notification-preview").map((each) => each.style.width),
      ).toContain("336px"),
    );
  });
});

describe("the events that get their own icon", () => {
  it("names a review request and an attribute change", async () => {
    const delegate = mount();

    await act(async () => {
      delegate.event({ event_name: "request_store_review", review_type: "in-app" });
      delegate.event({
        event_name: "user_attribute_updated",
        attributes: [{ key: "plan", value: "pro" }],
      });
    });

    expect(await screen.findByText("request_store_review")).toBeDefined();
    expect(await screen.findByText("user_attribute_updated")).toBeDefined();
  });

  it("still reports an event it has no icon for", async () => {
    const delegate = mount();

    await act(async () => {
      delegate.event({
        event_name: "post_checkout_complete",
        checkout_context_id: "ctx_1",
        product_identifier: "test:price_123:no-trial",
      });
    });

    expect(await screen.findByText("post_checkout_complete")).toBeDefined();
  });
});
