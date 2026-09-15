import { describe, expect, it } from "vitest";
import { allowedHostsOf, MAX_ALLOWED_HOSTS } from "../../src/config/allowedHosts";

describe("allowedHostsOf", () => {
  it("names nothing when the surface names nothing", () => {
    expect(allowedHostsOf(undefined)).toEqual({ origins: [], invalid: [] });
    expect(allowedHostsOf([])).toEqual({ origins: [], invalid: [] });
  });

  it("reads a bare hostname as an https origin", () => {
    expect(allowedHostsOf(["api.example.com"])).toEqual({
      origins: ["https://api.example.com"],
      invalid: [],
    });
  });

  it("accepts a pasted https URL and normalizes it to the same origin", () => {
    expect(allowedHostsOf(["https://api.example.com"]).origins).toEqual([
      "https://api.example.com",
    ]);
    expect(allowedHostsOf(["https://api.example.com/"]).origins).toEqual([
      "https://api.example.com",
    ]);
  });

  it("normalizes whitespace and case", () => {
    expect(allowedHostsOf([" API.Example.COM "]).origins).toEqual(["https://api.example.com"]);
  });

  it("keeps an explicit port", () => {
    expect(allowedHostsOf(["api.example.com:8443"]).origins).toEqual([
      "https://api.example.com:8443",
    ]);
  });

  it("allows a single-label host", () => {
    expect(allowedHostsOf(["internal-api"]).origins).toEqual(["https://internal-api"]);
  });

  describe("loopback is never a valid entry", () => {
    it.each([
      "localhost",
      "localhost:3000",
      "127.0.0.1",
      "127.0.0.1:8000",
      "http://localhost:3000",
      "https://localhost:3000",
      "http://127.0.0.1",
      "[::1]",
      "localhost:3000/",
    ])("refuses %s", (entry) => {
      expect(allowedHostsOf([entry])).toEqual({ origins: [], invalid: [entry] });
    });

    it("still refuses a host that merely looks local", () => {
      expect(allowedHostsOf(["localhost.evil.com"]).origins).toEqual([
        "https://localhost.evil.com",
      ]);
      expect(allowedHostsOf(["http://localhost.evil.com"]).invalid).toEqual([
        "http://localhost.evil.com",
      ]);
    });
  });

  it("never emits a plaintext origin, whatever the input", () => {
    const every = [
      "api.example.com",
      "https://api.example.com",
      "HTTP://API.EXAMPLE.COM",
      "http://localhost:3000",
      "localhost",
      "127.0.0.1:1",
      "api.example.com:8443",
    ];
    for (const origin of allowedHostsOf(every).origins) {
      expect(origin.startsWith("https://")).toBe(true);
    }
  });

  it("dedupes entries that normalize to the same origin", () => {
    expect(allowedHostsOf(["api.example.com", "https://API.example.com/"]).origins).toEqual([
      "https://api.example.com",
    ]);
  });

  it("sorts so the same config always produces the same wire bytes", () => {
    expect(allowedHostsOf(["z.example.com", "a.example.com"]).origins).toEqual([
      "https://a.example.com",
      "https://z.example.com",
    ]);
  });

  it.each([
    ["an empty entry", ""],
    ["whitespace only", "   "],
    ["a wildcard subdomain", "*.example.com"],
    ["a bare wildcard", "*"],

    ["http", "http://api.example.com"],
    ["a non-http scheme", "ftp://api.example.com"],
    ["a path", "api.example.com/v1/submit"],
    ["a query", "api.example.com?x=1"],
    ["userinfo", "user@api.example.com"],
    ["a space inside the host", "api example.com"],
    ["a leading dot", ".example.com"],
    ["a trailing dot", "example.com."],
    ["a leading hyphen", "-example.com"],
    ["a trailing hyphen", "example-.com"],
    ["an underscore", "api_v2.example.com"],
    ["an over-long port", "api.example.com:123456"],
    ["a non-numeric port", "api.example.com:https"],
  ])("rejects %s", (_label, entry) => {
    expect(allowedHostsOf([entry])).toEqual({ origins: [], invalid: [entry] });
  });

  it("rejects a non-string entry without throwing", () => {
    expect(allowedHostsOf([42 as unknown as string])).toEqual({ origins: [], invalid: ["42"] });
  });

  it("reports rejects in input order while still reading the valid ones", () => {
    expect(allowedHostsOf(["*.bad.com", "api.example.com", "http://worse.com"])).toEqual({
      origins: ["https://api.example.com"],
      invalid: ["*.bad.com", "http://worse.com"],
    });
  });

  it("caps at a reviewable number of hosts", () => {
    expect(MAX_ALLOWED_HOSTS).toBe(20);
  });
});
