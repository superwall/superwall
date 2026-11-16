import { afterEach, describe, expect, it, vi } from "vitest";
import { postCustomStoreSession } from "../../../src/checkout/api/customStore";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("postCustomStoreSession", () => {
  it("times the request out on a browser without AbortSignal.timeout", async () => {
    vi.useFakeTimers();
    const timeout = AbortSignal.timeout;
    Reflect.set(AbortSignal, "timeout", undefined);
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const pending = postCustomStoreSession("pk_1", {});
    await vi.advanceTimersByTimeAsync(20_000);
    Reflect.set(AbortSignal, "timeout", timeout);
    vi.useRealTimers();
    expect(await pending).toEqual({ kind: "timeout" });
  });

  it("posts the body once with the public key and reads the answer", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ checkoutUrl: "https://x" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const answer = await postCustomStoreSession("pk_1", { surface: "web" });
    expect(answer).toEqual({
      kind: "answered",
      ok: true,
      status: 200,
      body: { checkoutUrl: "https://x" },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/checkout\/custom-store\/session$/);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer pk_1" });
    expect(init.body).toBe(JSON.stringify({ surface: "web" }));
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("never retries a server error and keeps a body that is not JSON as undefined", async () => {
    const fetchMock = vi.fn(async () => new Response("bad gateway", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);
    const answer = await postCustomStoreSession("pk_1", {});
    expect(answer).toEqual({ kind: "answered", ok: false, status: 502, body: undefined });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("tells a timeout from a request that could not be sent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }),
    );
    expect(await postCustomStoreSession("pk_1", {})).toEqual({ kind: "timeout" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    expect(await postCustomStoreSession("pk_1", {})).toEqual({ kind: "unsent" });
  });
});
