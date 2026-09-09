import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "../../../src/checkout/api/fetch";

afterEach(() => {
  vi.unstubAllGlobals();
});

const respond = (...statuses: number[]) => {
  const queue = [...statuses];
  const fetchMock = vi.fn(async () => new Response("body", { status: queue.shift() ?? 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

describe("fetchWithRetry", () => {
  it("returns the first ok response", async () => {
    const fetchMock = respond(200);
    const response = await fetchWithRetry("https://x", {}, { retries: 2, backoffMs: 0 });
    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("never retries a client error", async () => {
    const fetchMock = respond(400, 200);
    await expect(fetchWithRetry("https://x", {}, { backoffMs: 0 })).rejects.toThrow(
      "Client error: 400 body",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries any server error, as paywall.js does", async () => {
    const fetchMock = respond(501, 200);
    const response = await fetchWithRetry("https://x", {}, { retries: 1, backoffMs: 0 });
    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a body it cannot read as empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        text: () => Promise.reject(new Error("stream broken")),
      })),
    );
    await expect(fetchWithRetry("https://x", {}, { retries: 0 })).rejects.toThrow(
      "Client error: 400 ",
    );
  });

  it("retries a retryable status and reports the last one when they run out", async () => {
    const fetchMock = respond(503, 502);
    await expect(fetchWithRetry("https://x", {}, { retries: 1, backoffMs: 0 })).rejects.toThrow(
      "Server error: 502 body",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("wraps a non-Error rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw "offline";
      }),
    );
    await expect(fetchWithRetry("https://x", {}, { retries: 0 })).rejects.toThrow("offline");
  });
});
