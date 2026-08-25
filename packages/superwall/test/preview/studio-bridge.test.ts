import { afterEach, describe, expect, it, vi } from "vitest";
import { STUDIO_CHANNEL, studioBridge } from "../../src/preview/studio-bridge";

const parentDescriptor = Object.getOwnPropertyDescriptor(window, "parent");

const embedInStudio = () => {
  const postMessage = vi.fn();
  Object.defineProperty(window, "parent", { configurable: true, get: () => ({ postMessage }) });
  return postMessage;
};

const lastPosted = (postMessage: ReturnType<typeof vi.fn>): Record<string, unknown> => {
  const call = postMessage.mock.calls.at(-1);
  if (!call) throw new Error("nothing was posted to the studio");
  const [message] = call;
  if (typeof message !== "object" || message === null) throw new Error("posted a non-object");
  return Object.fromEntries(Object.entries(message));
};

const answer = (id: unknown, outcome: string, channel: string = STUDIO_CHANNEL) =>
  window.dispatchEvent(
    new MessageEvent("message", { data: { channel, type: "answer", id, outcome } }),
  );

afterEach(() => {
  if (parentDescriptor) Object.defineProperty(window, "parent", parentDescriptor);
});

describe("studioBridge", () => {
  it("contributes nothing when the paywall is not embedded", () => {
    expect(window.parent).toBe(window);
    expect(studioBridge()).toEqual({});
  });

  it("forwards outgoing messages to the studio on its channel", () => {
    const postMessage = embedInStudio();
    const bridge = studioBridge();

    bridge.onOutgoing?.({ event_name: "close" });

    expect(postMessage).toHaveBeenCalledWith(
      { channel: STUDIO_CHANNEL, type: "event", message: { event_name: "close" } },
      window.origin,
    );
  });

  it("asks the studio for a purchase outcome and settles from the matching answer", async () => {
    const postMessage = embedInStudio();
    const bridge = studioBridge();

    const outcome = bridge.purchaseOutcome;
    if (typeof outcome !== "function") throw new Error("purchaseOutcome is not a function");
    const pending = outcome({ reference: "primary" });

    const ask = lastPosted(postMessage);
    expect(ask).toMatchObject({
      channel: STUDIO_CHANNEL,
      type: "ask",
      kind: "purchase",
      subject: "primary",
    });

    answer(ask.id, "completed", "some-other-channel");
    answer("not-this-one", "abandoned");
    answer(ask.id, "abandoned");

    await expect(pending).resolves.toBe("abandoned");
  });

  it("treats any non-abandoned purchase answer as completed", async () => {
    const postMessage = embedInStudio();
    const bridge = studioBridge();
    const outcome = bridge.purchaseOutcome;
    if (typeof outcome !== "function") throw new Error("purchaseOutcome is not a function");

    const pending = outcome({ reference: "primary" });
    answer(lastPosted(postMessage).id, "whatever");

    await expect(pending).resolves.toBe("completed");
  });

  it("maps permission answers onto granted or denied", async () => {
    const postMessage = embedInStudio();
    const bridge = studioBridge();

    const denied = bridge.onPermission?.("location");
    expect(lastPosted(postMessage)).toMatchObject({ kind: "permission", subject: "location" });
    answer(lastPosted(postMessage).id, "denied");
    await expect(denied).resolves.toBe("denied");

    const granted = bridge.onPermission?.("notification");
    answer(lastPosted(postMessage).id, "anything-else");
    await expect(granted).resolves.toBe("granted");
  });

  it("maps callback answers onto success or failure results", async () => {
    const postMessage = embedInStudio();
    const bridge = studioBridge();

    const failed = bridge.onCallback?.("signIn");
    expect(lastPosted(postMessage)).toMatchObject({ kind: "callback", subject: "signIn" });
    answer(lastPosted(postMessage).id, "failure");
    await expect(failed).resolves.toEqual({ status: "failure" });

    const succeeded = bridge.onCallback?.("signIn");
    answer(lastPosted(postMessage).id, "success");
    await expect(succeeded).resolves.toEqual({ status: "success" });
  });

  it("stops listening once an ask is answered", async () => {
    const postMessage = embedInStudio();
    const bridge = studioBridge();
    const removeListener = vi.spyOn(window, "removeEventListener");

    const pending = bridge.onCallback?.("done");
    const { id } = lastPosted(postMessage);
    answer(id, "success");
    await pending;

    expect(removeListener).toHaveBeenCalledWith("message", expect.any(Function));
    removeListener.mockRestore();
  });

  it("gives every ask a distinct id", () => {
    const postMessage = embedInStudio();
    const bridge = studioBridge();

    void bridge.onCallback?.("a");
    const first = lastPosted(postMessage).id;
    void bridge.onCallback?.("b");
    const second = lastPosted(postMessage).id;

    expect(first).not.toBe(second);
  });
});
