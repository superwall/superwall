import { act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TOutgoingMessage } from "@superwall/runtime";
import { useHaptics } from "../../src/hooks";
import { flush, renderWithProvider } from "../helpers";

describe("useHaptics", () => {
  it("sends one haptic_feedback message per variant", async () => {
    const onOutgoing = vi.fn<(message: TOutgoingMessage) => void>();
    const { result } = renderWithProvider(() => useHaptics(), { host: { onOutgoing } });
    await flush();

    act(() => {
      result.current.light();
      result.current.success();
      result.current.selection();
    });

    for (const haptic_type of ["light", "success", "selection"]) {
      expect(onOutgoing).toHaveBeenCalledWith(
        expect.objectContaining({ event_name: "haptic_feedback", haptic_type }),
      );
    }
  });

  it("covers every haptic the protocol accepts", async () => {
    const onOutgoing = vi.fn<(message: TOutgoingMessage) => void>();
    const { result } = renderWithProvider(() => useHaptics(), { host: { onOutgoing } });
    await flush();

    const variants = ["light", "medium", "heavy", "success", "warning", "error", "selection"];
    expect(Object.keys(result.current).toSorted()).toEqual(variants.toSorted());

    act(() => {
      for (const variant of variants) result.current[variant as keyof typeof result.current]();
    });

    const sent = onOutgoing.mock.calls
      .map(([message]) => message)
      .filter((message) => message.event_name === "haptic_feedback")
      .map((message) => (message as { haptic_type: string }).haptic_type);
    expect(sent).toEqual(variants);
  });
});
