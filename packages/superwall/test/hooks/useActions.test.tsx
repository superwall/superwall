import { act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TOutgoingMessage } from "@superwall/runtime";
import { useActions, useUser } from "../../src/hooks";
import { flush, renderWithProvider } from "../helpers";

describe("useActions", () => {
  it("dispatches paywall actions to the host", async () => {
    const onOutgoing = vi.fn<(message: TOutgoingMessage) => void>();
    const { result } = renderWithProvider(() => useActions(), { host: { onOutgoing } });
    await flush();

    act(() => {
      result.current.close();
      result.current.openExternalUrl("https://superwall.com");
    });

    expect(onOutgoing).toHaveBeenCalledWith(expect.objectContaining({ event_name: "ping" }));
    expect(onOutgoing).toHaveBeenCalledWith(expect.objectContaining({ event_name: "close" }));
    expect(onOutgoing).toHaveBeenCalledWith(
      expect.objectContaining({ event_name: "open_url_external", url: "https://superwall.com" }),
    );
  });

  it("sends a custom action to the host by name", async () => {
    const onOutgoing = vi.fn<(message: TOutgoingMessage) => void>();
    const { result } = renderWithProvider(() => useActions(), { host: { onOutgoing } });
    await flush();

    act(() => {
      result.current.customAction("open_settings");
    });

    expect(onOutgoing).toHaveBeenCalledWith({ event_name: "custom", data: "open_settings" });
  });

  it("sets user attributes on the host and on the paywall's own user record", async () => {
    const onOutgoing = vi.fn<(message: TOutgoingMessage) => void>();
    const { result } = renderWithProvider(() => ({ actions: useActions(), user: useUser() }), {
      host: { onOutgoing, user: { firstName: "Ada" } },
    });
    await flush();

    act(() => {
      result.current.actions.setUserAttributes({ email: "ada@example.com" });
    });

    expect(onOutgoing).toHaveBeenCalledWith({
      event_name: "user_attribute_updated",
      attributes: [{ key: "email", value: "ada@example.com" }],
    });
    expect(result.current.user).toEqual({ firstName: "Ada", email: "ada@example.com" });
  });
});
