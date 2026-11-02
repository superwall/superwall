import { afterEach, describe, expect, it, vi } from "vitest";
import { uuid } from "../../src/checkout/uuid";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const withoutRandomUUID = () =>
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("uuid", () => {
  it("uses crypto.randomUUID when the page has it", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("11111111-2222-4333-8444-555555555555");
    expect(uuid()).toBe("11111111-2222-4333-8444-555555555555");
  });

  it("builds a v4 UUID from crypto.getRandomValues outside a secure context", () => {
    withoutRandomUUID();
    expect(typeof crypto.randomUUID).toBe("undefined");
    const ids = Array.from({ length: 50 }, uuid);
    for (const id of ids) expect(id).toMatch(V4);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("sets the version and variant bits whatever the random bytes are", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(0xff),
    });
    expect(uuid()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(0),
    });
    expect(uuid()).toBe("00000000-0000-4000-8000-000000000000");
  });
});
