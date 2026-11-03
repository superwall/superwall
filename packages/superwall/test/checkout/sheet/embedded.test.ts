import { describe, expect, it, vi } from "vitest";
import type { Stripe } from "@stripe/stripe-js";
import {
  createEmbeddedCheckouts,
  type EmbeddedHandlers,
  type EmbeddedRequest,
} from "../../../src/checkout/sheet/embedded";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (e: unknown) => void;
};

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const fakeStripe = (options: { initDelay?: () => Promise<void> } = {}) => {
  let alive = 0;
  const log: string[] = [];
  const stripe = {
    initEmbeddedCheckout: async ({ clientSecret }: { clientSecret: string }) => {
      log.push(`init ${clientSecret}`);
      if (alive > 0) throw new Error("You cannot have multiple Embedded Checkout objects.");
      alive++;
      await options.initDelay?.();
      let destroyed = false;
      return {
        mount: (element: HTMLElement) => {
          log.push(`mount ${clientSecret}`);
          element.dataset.mounted = clientSecret;
        },
        unmount: () => {},
        destroy: () => {
          if (destroyed) return;
          destroyed = true;
          alive--;
          log.push(`destroy ${clientSecret}`);
        },
      };
    },
  };
  return { stripe: stripe as unknown as Stripe, log, alive: () => alive };
};

const handlersOf = (overrides: Partial<EmbeddedHandlers> = {}) => ({
  current: {
    onComplete: vi.fn(),
    onAnalyticsEvent: vi.fn(),
    onError: vi.fn(),
    onStage: vi.fn(),
    ...overrides,
  },
});

const request = (clientSecret: string, handlers = handlersOf()): EmbeddedRequest => ({
  session: { clientSecret, publishableKey: "pk_test" },
  element: document.createElement("div"),
  handlers,
});

describe("one Stripe embedded checkout per page", () => {
  it("starts only the newest session when stripe.js arrives after two prefetched ones", async () => {
    const fake = fakeStripe();
    const script = deferred<Stripe | null>();
    const checkouts = createEmbeddedCheckouts(() => script.promise);
    const first = request("cs_first");
    const second = request("cs_second");

    const releaseFirst = checkouts.show(first);
    releaseFirst();
    checkouts.show(second);
    script.resolve(fake.stripe);
    await flush();

    expect(fake.log).toEqual(["init cs_second", "mount cs_second"]);
    expect(second.element.dataset.mounted).toBe("cs_second");
    expect(first.handlers.current.onError).not.toHaveBeenCalled();
    expect(second.handlers.current.onError).not.toHaveBeenCalled();
  });

  it("loads Stripe once per publishable key", async () => {
    const fake = fakeStripe();
    const load = vi.fn(() => Promise.resolve(fake.stripe));
    const checkouts = createEmbeddedCheckouts(load);

    checkouts.show(request("cs_a"));
    await flush();
    checkouts.show(request("cs_b"));
    await flush();

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("destroys a checkout that finishes starting after its sheet unmounted", async () => {
    const gate = deferred<void>();
    const fake = fakeStripe({ initDelay: () => gate.promise });
    const checkouts = createEmbeddedCheckouts(() => Promise.resolve(fake.stripe));
    const first = request("cs_first");

    const release = checkouts.show(first);
    await flush();
    release();
    gate.resolve();
    await flush();

    expect(fake.log).toEqual(["init cs_first", "destroy cs_first"]);
    expect(first.element.dataset.mounted).toBeUndefined();
    expect(fake.alive()).toBe(0);
  });

  it("waits for a starting checkout before starting the next, never holding two", async () => {
    const gate = deferred<void>();
    let delays = 0;
    const fake = fakeStripe({
      initDelay: () => (delays++ === 0 ? gate.promise : Promise.resolve()),
    });
    const checkouts = createEmbeddedCheckouts(() => Promise.resolve(fake.stripe));
    const first = request("cs_first");
    const second = request("cs_second");

    checkouts.show(first);
    await flush();
    checkouts.show(second);
    await flush();
    expect(fake.log).toEqual(["init cs_first"]);

    gate.resolve();
    await flush();

    expect(fake.log).toEqual([
      "init cs_first",
      "destroy cs_first",
      "init cs_second",
      "mount cs_second",
    ]);
    expect(second.handlers.current.onError).not.toHaveBeenCalled();
    expect(fake.alive()).toBe(1);
  });

  it("destroys the mounted checkout before starting a swapped-in session", async () => {
    const fake = fakeStripe();
    const checkouts = createEmbeddedCheckouts(() => Promise.resolve(fake.stripe));

    const releaseFirst = checkouts.show(request("cs_first"));
    await flush();
    releaseFirst();
    checkouts.show(request("cs_second"));
    await flush();

    expect(fake.log).toEqual([
      "init cs_first",
      "mount cs_first",
      "destroy cs_first",
      "init cs_second",
      "mount cs_second",
    ]);
  });

  it("ignores a stale release once another session took over", async () => {
    const fake = fakeStripe();
    const checkouts = createEmbeddedCheckouts(() => Promise.resolve(fake.stripe));

    const releaseFirst = checkouts.show(request("cs_first"));
    checkouts.show(request("cs_second"));
    releaseFirst();
    await flush();

    expect(fake.log).toEqual(["init cs_second", "mount cs_second"]);
  });

  it("forwards Stripe's callbacks to the latest handlers", async () => {
    let options: {
      onComplete?: () => void;
      onAnalyticsEvent?: (e: { eventType: string }) => void;
    } = {};
    const stripe = {
      initEmbeddedCheckout: (given: typeof options) => {
        options = given;
        return Promise.resolve({ mount: () => {}, unmount: () => {}, destroy: () => {} });
      },
    } as unknown as Stripe;
    const checkouts = createEmbeddedCheckouts(() => Promise.resolve(stripe));
    const handlers = handlersOf();

    checkouts.show(request("cs_a", handlers));
    await flush();
    const later = handlersOf();
    handlers.current = later.current;
    options.onComplete?.();
    options.onAnalyticsEvent?.({ eventType: "checkoutRendered" });

    expect(later.current.onComplete).toHaveBeenCalled();
    expect(later.current.onAnalyticsEvent).toHaveBeenCalledWith({ eventType: "checkoutRendered" });
  });
});

describe("the stages it reports", () => {
  it("reports stripe.js loaded, then the checkout mounted", async () => {
    const fake = fakeStripe();
    const checkouts = createEmbeddedCheckouts(() => Promise.resolve(fake.stripe));
    const shown = request("cs_a");

    checkouts.show(shown);
    await flush();

    expect(vi.mocked(shown.handlers.current.onStage).mock.calls).toEqual([
      ["stripe_js_loaded"],
      ["embedded_mounted"],
    ]);
  });

  it("reports no mount when Stripe refused to start the checkout", async () => {
    const stripe = {
      initEmbeddedCheckout: () => Promise.reject(new Error("refused")),
    } as unknown as Stripe;
    const checkouts = createEmbeddedCheckouts(() => Promise.resolve(stripe));
    const shown = request("cs_a");

    checkouts.show(shown);
    await flush();

    expect(vi.mocked(shown.handlers.current.onStage).mock.calls).toEqual([["stripe_js_loaded"]]);
  });
});

describe("when Stripe fails", () => {
  it("reports an initEmbeddedCheckout rejection and starts again on the next show", async () => {
    let calls = 0;
    const stripe = {
      initEmbeddedCheckout: () => {
        calls++;
        if (calls === 1)
          return Promise.reject(new Error("You cannot have multiple Embedded Checkout objects."));
        return Promise.resolve({ mount: () => {}, unmount: () => {}, destroy: () => {} });
      },
    } as unknown as Stripe;
    const checkouts = createEmbeddedCheckouts(() => Promise.resolve(stripe));
    const failed = request("cs_a");

    const release = checkouts.show(failed);
    await flush();
    expect(failed.handlers.current.onError).toHaveBeenCalledWith(
      new Error("You cannot have multiple Embedded Checkout objects."),
    );
    expect(calls).toBe(1);

    release();
    const retried = request("cs_a");
    checkouts.show(retried);
    await flush();

    expect(calls).toBe(2);
    expect(retried.handlers.current.onError).not.toHaveBeenCalled();
  });

  it("starts a failed checkout again on retry, with the same mounted request", async () => {
    let calls = 0;
    const stripe = {
      initEmbeddedCheckout: () => {
        calls++;
        if (calls === 1) return Promise.reject(new Error("init failed"));
        return Promise.resolve({ mount: () => {}, unmount: () => {}, destroy: () => {} });
      },
    } as unknown as Stripe;
    const checkouts = createEmbeddedCheckouts(() => Promise.resolve(stripe));
    const shown = request("cs_a");

    checkouts.show(shown);
    await flush();
    expect(calls).toBe(1);

    checkouts.retry("cs_other");
    await flush();
    expect(calls).toBe(1);

    checkouts.retry("cs_a");
    await flush();
    expect(calls).toBe(2);
    expect(shown.handlers.current.onStage).toHaveBeenCalledWith("embedded_mounted");

    checkouts.retry("cs_a");
    await flush();
    expect(calls).toBe(2);
  });

  it("does nothing on retry while the checkout is still starting", async () => {
    const script = deferred<Stripe | null>();
    const fake = fakeStripe();
    const checkouts = createEmbeddedCheckouts(() => script.promise);

    checkouts.show(request("cs_a"));
    checkouts.retry("cs_a");
    script.resolve(fake.stripe);
    await flush();

    expect(fake.log).toEqual(["init cs_a", "mount cs_a"]);
  });

  it("reports a stripe.js that resolves to nothing", async () => {
    const checkouts = createEmbeddedCheckouts(() => Promise.resolve(null));
    const shown = request("cs_a");

    checkouts.show(shown);
    await flush();

    expect(shown.handlers.current.onError).toHaveBeenCalledWith(
      new Error("Stripe.js did not load"),
    );
  });

  it("loads stripe.js again after it failed to load", async () => {
    const fake = fakeStripe();
    const load = vi
      .fn<() => Promise<Stripe | null>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(fake.stripe);
    const checkouts = createEmbeddedCheckouts(load);
    const failed = request("cs_a");

    const release = checkouts.show(failed);
    await flush();
    expect(failed.handlers.current.onError).toHaveBeenCalledWith(new Error("network"));

    release();
    checkouts.show(request("cs_a"));
    await flush();

    expect(load).toHaveBeenCalledTimes(2);
    expect(fake.log).toEqual(["init cs_a", "mount cs_a"]);
  });

  it("destroys and reports a checkout that cannot mount", async () => {
    const destroy = vi.fn();
    const stripe = {
      initEmbeddedCheckout: () =>
        Promise.resolve({
          mount: () => {
            throw new Error("mount failed");
          },
          unmount: () => {},
          destroy,
        }),
    } as unknown as Stripe;
    const checkouts = createEmbeddedCheckouts(() => Promise.resolve(stripe));
    const shown = request("cs_a");

    checkouts.show(shown);
    await flush();

    expect(destroy).toHaveBeenCalled();
    expect(shown.handlers.current.onError).toHaveBeenCalledWith(new Error("mount failed"));
  });

  it("keeps going when Stripe throws while destroying", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let n = 0;
    const stripe = {
      initEmbeddedCheckout: () =>
        Promise.resolve({
          mount: () => {},
          unmount: () => {},
          destroy: () => {
            if (n++ === 0) throw new Error("already gone");
          },
        }),
    } as unknown as Stripe;
    const checkouts = createEmbeddedCheckouts(() => Promise.resolve(stripe));
    const second = request("cs_b");

    const release = checkouts.show(request("cs_a"));
    await flush();
    release();
    checkouts.show(second);
    await flush();

    expect(errors).toHaveBeenCalled();
    expect(second.handlers.current.onError).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("loads stripe.js again after it resolved to nothing", async () => {
    const fake = fakeStripe();
    const load = vi
      .fn<() => Promise<Stripe | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(fake.stripe);
    const checkouts = createEmbeddedCheckouts(load);

    const release = checkouts.show(request("cs_a"));
    await flush();
    release();
    checkouts.show(request("cs_a"));
    await flush();

    expect(load).toHaveBeenCalledTimes(2);
    expect(fake.log).toEqual(["init cs_a", "mount cs_a"]);
  });

  it("keeps a reload in place when an older failed load settles late", async () => {
    const fake = fakeStripe();
    const first = deferred<Stripe | null>();
    const load = vi
      .fn<() => Promise<Stripe | null>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(fake.stripe);
    const checkouts = createEmbeddedCheckouts(load);

    const release = checkouts.show(request("cs_a"));
    first.reject(new Error("network"));
    await flush();
    release();
    checkouts.show(request("cs_b"));
    await flush();
    const later = request("cs_c");
    checkouts.show(later);
    await flush();

    expect(load).toHaveBeenCalledTimes(2);
    expect(later.handlers.current.onError).not.toHaveBeenCalled();
  });
});

describe("when a handler throws", () => {
  it("still mounts the checkout when reporting a stage throws", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = fakeStripe();
    const checkouts = createEmbeddedCheckouts(() => Promise.resolve(fake.stripe));
    const shown = request(
      "cs_a",
      handlersOf({
        onStage: () => {
          throw new Error("reporting broke");
        },
      }),
    );

    checkouts.show(shown);
    await flush();

    expect(fake.log).toEqual(["init cs_a", "mount cs_a"]);
    expect(shown.handlers.current.onError).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith("[checkout] a checkout handler failed:", expect.any(Error));
    errors.mockRestore();
  });

  it("keeps serving later sessions when the error handler throws", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = fakeStripe();
    const load = vi
      .fn<() => Promise<Stripe | null>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(fake.stripe);
    const checkouts = createEmbeddedCheckouts(load);
    const failing = request(
      "cs_a",
      handlersOf({
        onError: () => {
          throw new Error("handler broke");
        },
      }),
    );

    const release = checkouts.show(failing);
    await flush();
    release();
    checkouts.show(request("cs_b"));
    await flush();

    expect(fake.log).toEqual(["init cs_b", "mount cs_b"]);
    errors.mockRestore();
  });
});
