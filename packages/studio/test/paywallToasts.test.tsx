import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaywallToasts } from "../src/components/PaywallToasts";
import { STUDIO_CHANNEL } from "../src/lib/events";

const sourceWindow = { postMessage: vi.fn() };

const send = async (data: unknown) => {
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", { data, source: sourceWindow as unknown as Window }),
    );
    await Promise.resolve();
  });
};

afterEach(() => sourceWindow.postMessage.mockClear());

describe("PaywallToasts", () => {
  it("reports what the paywall asked of its host", async () => {
    render(<PaywallToasts surfaceKey="a/pro" />);
    await send({ channel: STUDIO_CHANNEL, type: "event", message: { event_name: "close" } });

    expect(await screen.findByText("close")).toBeDefined();
  });

  it("says nothing for events a device would not act on", async () => {
    render(<PaywallToasts surfaceKey="a/pro" />);
    await send({
      channel: STUDIO_CHANNEL,
      type: "event",
      message: { event_name: "haptic_feedback" },
    });

    expect(screen.queryByText(/haptic/i)).toBeNull();
  });

  it("answers a pending purchase, so the paywall resolves the way you chose", async () => {
    render(<PaywallToasts surfaceKey="a/pro" />);
    await send({
      channel: STUDIO_CHANNEL,
      type: "ask",
      id: "purchase-1",
      kind: "purchase",
      reference: "annual",
    });

    expect(await screen.findByText("annual")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));

    expect(sourceWindow.postMessage).toHaveBeenCalledWith(
      { channel: STUDIO_CHANNEL, type: "answer", id: "purchase-1", outcome: "completed" },
      "*",
    );
    expect(await screen.findByText(/purchase completed/)).toBeDefined();
  });

  it("abandons when you say so, rather than defaulting to a sale", async () => {
    render(<PaywallToasts surfaceKey="a/pro" />);
    await send({
      channel: STUDIO_CHANNEL,
      type: "ask",
      id: "purchase-2",
      kind: "purchase",
      reference: "monthly",
    });
    fireEvent.click(await screen.findByRole("button", { name: "Abandon" }));

    expect(sourceWindow.postMessage).toHaveBeenCalledWith(
      { channel: STUDIO_CHANNEL, type: "answer", id: "purchase-2", outcome: "abandoned" },
      "*",
    );
    expect(await screen.findByText(/purchase abandoned/)).toBeDefined();
  });

  it("ignores window traffic that is not the preview's", async () => {
    render(<PaywallToasts surfaceKey="a/pro" />);
    await send({ type: "event", message: { event_name: "close" } });
    await send("vite-hmr");

    expect(screen.queryByText("close")).toBeNull();
    expect(sourceWindow.postMessage).not.toHaveBeenCalled();
  });
});
