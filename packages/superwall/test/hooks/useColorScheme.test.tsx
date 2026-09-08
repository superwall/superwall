import { describe, expect, it, vi } from "vitest";
import { useColorScheme } from "../../src/hooks/useColorScheme";
import { flush, renderWithProvider } from "../helpers";

const withSystemDark = (dark: boolean) => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: dark && query.includes("dark"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
};

const scheme = async (device: Record<string, unknown>) => {
  const { result } = renderWithProvider(() => useColorScheme(), { host: { device } });
  await flush();
  return result.current;
};

describe("useColorScheme", () => {
  it("follows the device, because that is what the person is looking at", async () => {
    withSystemDark(false);
    expect(await scheme({ interfaceStyle: "Dark" })).toBe("dark");

    withSystemDark(true);
    expect(await scheme({ interfaceStyle: "Light" })).toBe("light");
  });

  it("reads the SDK's casing however it arrives", async () => {
    withSystemDark(false);
    expect(await scheme({ interfaceStyle: "dark" })).toBe("dark");
    expect(await scheme({ interfaceStyle: "DARK" })).toBe("dark");
  });

  it("falls back to the OS when the host reports nothing", async () => {
    withSystemDark(true);
    expect(await scheme({ interfaceStyle: undefined })).toBe("dark");

    withSystemDark(false);
    expect(await scheme({ interfaceStyle: undefined })).toBe("light");
  });

  it("treats an unrecognised value as no answer rather than guessing", async () => {
    withSystemDark(true);
    expect(await scheme({ interfaceStyle: "Unspecified" })).toBe("dark");
  });
});
