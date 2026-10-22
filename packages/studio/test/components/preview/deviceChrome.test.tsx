import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeviceChrome, duoLayout } from "../../../src/components/preview/DeviceChrome";
import type { DeviceChromeSpec } from "../../../src/lib/devices";

const island: DeviceChromeSpec = {
  radius: 55,
  cutout: "island",
  statusBarHeight: 54,
  homeIndicator: true,
};
const punch: DeviceChromeSpec = {
  radius: 28,
  cutout: "punch",
  statusBarHeight: 48,
  homeIndicator: true,
};

const cutout = (container: HTMLElement) =>
  [...container.querySelectorAll("div.rounded-full.bg-black")].map((node) => ({
    left: (node as HTMLElement).style.left,
    top: (node as HTMLElement).style.top,
    width: (node as HTMLElement).style.width,
    height: (node as HTMLElement).style.height,
  }));

describe("DeviceChrome", () => {
  it("stands the dynamic island on its side in landscape", () => {
    const portrait = render(
      <DeviceChrome spec={island} width={390} height={844} landscape={false} theme="light" />,
    );
    expect(cutout(portrait.container)[0]).toEqual({
      left: "133px",
      top: "12px",
      width: "124px",
      height: "36px",
    });

    const landscape = render(
      <DeviceChrome spec={island} width={844} height={390} landscape theme="light" />,
    );
    expect(cutout(landscape.container)[0]).toEqual({
      left: "12px",
      top: "133px",
      width: "36px",
      height: "124px",
    });
  });

  it("moves a punch-hole to the edge in landscape", () => {
    const portrait = render(
      <DeviceChrome spec={punch} width={390} height={844} landscape={false} theme="light" />,
    );
    expect(cutout(portrait.container)[0]).toEqual({
      left: "188.5px",
      top: "15px",
      width: "13px",
      height: "13px",
    });

    const landscape = render(
      <DeviceChrome spec={punch} width={844} height={390} landscape theme="light" />,
    );
    expect(cutout(landscape.container)[0]).toEqual({
      left: "16px",
      top: "188.5px",
      width: "13px",
      height: "13px",
    });
  });

  it("hides the status bar in landscape, and inks itself for the theme", () => {
    const portrait = render(
      <DeviceChrome spec={island} width={390} height={844} landscape={false} theme="dark" />,
    );
    const dark = portrait.container.querySelector<HTMLElement>("[data-testid=device-chrome]");
    expect(dark?.style.color).toBe("rgba(255, 255, 255, 0.95)");
    expect(dark?.textContent).toContain("9:41");
    portrait.unmount();

    const landscape = render(
      <DeviceChrome spec={island} width={844} height={390} landscape theme="light" />,
    );
    const light = landscape.container.querySelector<HTMLElement>("[data-testid=device-chrome]");
    expect(light?.style.color).toBe("rgba(0, 0, 0, 0.95)");
    expect(light?.textContent).not.toContain("9:41");
  });

  it("draws no cutout for a device that has none", () => {
    const { container } = render(
      <DeviceChrome
        spec={{ radius: 12, statusBarHeight: 24, homeIndicator: false }}
        width={1024}
        height={768}
        landscape={false}
        theme="light"
      />,
    );

    expect(cutout(container)).toEqual([]);
  });
});

describe("DeviceChrome on iPhone Duo", () => {
  const spec = (duo: "closed" | "open"): DeviceChromeSpec => ({
    radius: 40,
    duo,
    statusBarHeight: 0,
    homeIndicator: true,
  });

  it("draws the closed phone's camera and status in its strip, over the paywall", () => {
    const view = render(
      <DeviceChrome
        spec={spec("closed")}
        width={466}
        height={678}
        landscape={false}
        theme="light"
      />,
    );
    expect(view.getByTestId("duo-camera").style.left).toBe("418.2px");
    expect(view.getByTestId("duo-status").style.mixBlendMode).toBe("difference");
    expect(view.getAllByText("9:41")).toHaveLength(1);
  });

  it("hides the closed phone's status in landscape and keeps the camera", () => {
    const view = render(
      <DeviceChrome spec={spec("closed")} width={678} height={466} landscape theme="light" />,
    );
    expect(view.getByTestId("duo-camera")).toBeTruthy();
    expect(view.queryByTestId("duo-status")).toBeNull();
  });

  it("shows only the status on the open phone, whose camera is on the outer display", () => {
    const view = render(
      <DeviceChrome spec={spec("open")} width={669} height={951} landscape={false} theme="light" />,
    );
    expect(view.queryByTestId("duo-camera")).toBeNull();
    expect(view.getByTestId("duo-status")).toBeTruthy();
  });

  it("has a corner per side of the fold", () => {
    expect(duoLayout("closed", false).corners).toEqual([8, 59, 59, 8]);
    expect(duoLayout("open", true).corners).toEqual([55, 55, 55, 55]);
  });
});
