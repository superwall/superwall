import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDevice, useProducts, useTrialEligibility } from "../../src/hooks";
import { PreviewHost, previewMockOptions } from "../../src/preview/host";
import { STUDIO_CHANNEL } from "../../src/preview/studio-bridge";
import { flush, testConfig } from "../helpers";

const parentDescriptor = Object.getOwnPropertyDescriptor(window, "parent");

const embedInStudio = () => {
  const postMessage = vi.fn();
  Object.defineProperty(window, "parent", { configurable: true, get: () => ({ postMessage }) });
  return postMessage;
};

const Probe = () => {
  const device = useDevice();
  const products = useProducts();
  const trial = useTrialEligibility();
  return (
    <output>
      {JSON.stringify({
        style: device.interfaceStyle,
        locale: device.deviceLocale,
        price: products.getProduct("primary")?.variables.price,
        trial: trial.eligible,
      })}
    </output>
  );
};

const probed = () => JSON.parse(screen.getByRole("status").textContent ?? "{}");

const open = (search: string) => window.history.replaceState({}, "", `/paywall.html${search}`);

afterEach(() => {
  if (parentDescriptor) Object.defineProperty(window, "parent", parentDescriptor);
  document.documentElement.style.colorScheme = "";
  document.documentElement.classList.remove("dark", "light");
});

describe("PreviewHost", () => {
  it("runs against the real host unless the page opts into a preview", async () => {
    open("?theme=dark");
    render(
      <PreviewHost config={testConfig}>
        <Probe />
      </PreviewHost>,
    );
    await flush();

    expect(window.__swPreviewApply).toBeUndefined();
    expect(probed().style).toBeUndefined();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("simulates the SDK from the studio's query params once opted in", async () => {
    open(
      `?sw_preview=1&theme=dark&locale=de-DE&sw_trial=0&sw_products=${encodeURIComponent(
        JSON.stringify({ primary: { price: "€39.99" } }),
      )}`,
    );
    render(
      <PreviewHost config={testConfig}>
        <Probe />
      </PreviewHost>,
    );
    await flush();

    expect(probed()).toEqual({ style: "Dark", locale: "de-DE", price: "€39.99", trial: false });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(typeof window.__swPreviewApply).toBe("function");
  });

  it("re-applies overrides in place when the studio pushes a new query", async () => {
    open("?sw_preview=1&theme=dark");
    const view = render(
      <PreviewHost config={testConfig}>
        <Probe />
      </PreviewHost>,
    );
    await flush();
    expect(probed().style).toBe("Dark");

    act(() => {
      window.__swPreviewApply?.("?theme=light&locale=fr");
    });
    await flush();

    expect(probed()).toMatchObject({ style: "Light", locale: "fr" });
    expect(window.location.search).toBe("?sw_preview=1&theme=light&locale=fr");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    view.unmount();
    expect(window.__swPreviewApply).toBeUndefined();
  });

  it("tells an embedding studio which locales the paywall carries", async () => {
    open("?sw_preview=1");
    const postMessage = embedInStudio();
    render(
      <PreviewHost config={testConfig}>
        <Probe />
      </PreviewHost>,
    );
    await flush();

    expect(postMessage).toHaveBeenCalledWith(
      { channel: STUDIO_CHANNEL, type: "hello", locales: ["en", "de"] },
      "*",
    );
  });

  it("announces no locales for a paywall without catalogs", async () => {
    open("?sw_preview=1");
    const postMessage = embedInStudio();
    render(
      <PreviewHost config={{}}>
        <span />
      </PreviewHost>,
    );
    await flush();

    expect(postMessage).toHaveBeenCalledWith(
      { channel: STUDIO_CHANNEL, type: "hello", locales: [] },
      "*",
    );
  });
});

describe("previewMockOptions", () => {
  it("maps the studio's overrides onto the mock host", () => {
    const options = previewMockOptions(
      {
        theme: "light",
        locale: "es-MX",
        user: { plan: "go" },
        params: { source: "onboarding" },
        device: { platform: "Android" },
        trialEligible: true,
        products: { secondary: { price: "$9.99" }, ghost: { price: "$1" } },
      },
      testConfig,
    );

    expect(options.device).toEqual({
      platform: "Android",
      deviceLocale: "es-MX",
      deviceLanguageCode: "es",
      interfaceStyle: "Light",
    });
    expect(options.user).toEqual({ plan: "go" });
    expect(options.params).toEqual({ source: "onboarding" });
    expect(options.trialEligible).toBe(true);
    expect(options.products).toEqual([
      expect.objectContaining({ reference: "primary" }),
      expect.objectContaining({
        reference: "secondary",
        variables: { identifier: "pro_999_month", price: "$9.99" },
      }),
    ]);
  });

  it("leaves products to the config when nothing is overridden", () => {
    expect(previewMockOptions({}, testConfig)).toEqual({ device: {} });
  });
});
