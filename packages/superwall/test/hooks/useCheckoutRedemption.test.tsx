import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TOutgoingMessage } from "@superwall/runtime";
import { useCheckoutRedemption } from "../../src/hooks";
import { completedWebCheckout } from "../../src/checkout/redemption";
import { flush, renderWithProvider } from "../helpers";

afterEach(() => {
  completedWebCheckout.set(undefined);
  vi.unstubAllGlobals();
});

describe("useCheckoutRedemption", () => {
  it("is idle until a stay-checkout completes, then exposes its targets", async () => {
    const { result } = renderWithProvider(() => useCheckoutRedemption());
    await flush();

    expect(result.current.completed).toBe(false);
    expect(result.current.redemptionUrl).toBeUndefined();

    act(() => {
      completedWebCheckout.set({
        redemptionUrl: "https://redeem.example.com/abc",
        deepLinkUrl: "myapp://redeem/abc",
        postCheckoutRequestUrl: "https://api.example.com/post",
      });
    });

    expect(result.current.completed).toBe(true);
    expect(result.current.redemptionUrl).toBe("https://redeem.example.com/abc");
    expect(result.current.appLink).toBe("myapp://redeem/abc");
  });

  it("opens the app through the deep link, and does nothing without one", async () => {
    const onOutgoing = vi.fn<(message: TOutgoingMessage) => void>();
    const { result } = renderWithProvider(() => useCheckoutRedemption(), { host: { onOutgoing } });
    await flush();

    act(() => result.current.openApp());
    expect(onOutgoing).not.toHaveBeenCalledWith(
      expect.objectContaining({ event_name: "open_deep_link" }),
    );

    act(() => {
      completedWebCheckout.set({ deepLinkUrl: "myapp://redeem/abc" });
    });
    act(() => result.current.openApp());
    expect(onOutgoing).toHaveBeenCalledWith({
      event_name: "open_deep_link",
      link: "myapp://redeem/abc",
    });
  });

  it("redeems and redirects through the post-checkout endpoint", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ redirectUrl: "https://app.example.com/welcome" })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderWithProvider(() => useCheckoutRedemption());
    await flush();

    act(() => {
      completedWebCheckout.set({ postCheckoutRequestUrl: "https://api.example.com/post" });
    });

    await act(async () => {
      await result.current.redeem();
    });
    const [, redeemInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(redeemInit.body))).toEqual({ resolution: { type: "redeem" } });

    await act(async () => {
      await result.current.redirect("https://mysite.example.com/thanks");
    });
    const [, redirectInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(String(redirectInit.body))).toEqual({
      resolution: { type: "redirect", url: "https://mysite.example.com/thanks" },
    });

    await act(async () => {
      await result.current.finish();
    });
    const [, finishInit] = fetchMock.mock.calls[2] as unknown as [string, RequestInit];
    expect(JSON.parse(String(finishInit.body))).toEqual({ resolution: { type: "default" } });
  });
});
