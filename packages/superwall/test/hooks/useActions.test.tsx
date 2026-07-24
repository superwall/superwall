import { act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TOutgoingMessage } from "@superwall/runtime";
import { useActions } from "../../src";
import { flush, renderWithProvider } from "../helpers";

describe("useActions", () => {
  it("dispatches paywall actions to the host", async () => {
    const onOutgoing = vi.fn<(message: TOutgoingMessage) => void>();
    const { result } = renderWithProvider(() => useActions(), { mock: { onOutgoing } });
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
});
