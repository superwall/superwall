import { act, fireEvent, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { buildPreviewPath } from "../src/lib/preview";
import { StudioApp } from "../src/StudioApp";
import type { StudioSource } from "../src/lib/types";

/** Renders with a stubbed dashboard catalogue, the only source of product data. */
const withCatalogue = async (
  catalogue: Record<string, Record<string, unknown>> | undefined,
  ui: React.ReactElement,
) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) =>
      String(input).includes("samples.json")
        ? { json: async () => ({ products: catalogue }) }
        : { json: async () => ({}) },
    ),
  );
  const view = render(ui);
  await act(async () => {});
  return view;
};

const shippable: StudioSource = {
  title: "chatgpt",
  surfaces: [
    {
      kind: "paywall",
      id: "plus-upgrade",
      routes: ["/"],
      locales: ["en", "es"],
      products: { annual: "pro_5999_year" },
      paywallId: "208540",
    },
    { kind: "funnel", id: "onboarding", routes: ["/", "/step-2"], locales: ["en"] },
  ],
  diagnostics: [],
  samples: {
    device: { platform: "iOS" },
    user: { subscriptionStatus: "INACTIVE" },
    params: { placementName: "campaign_trigger", isFeatureGatable: false },
  },
  capabilities: { actions: true },
  previewUrl: buildPreviewPath,
};

const source: StudioSource = { ...shippable, capabilities: undefined };

describe("the overview", () => {
  const many = {
    ...source,
    title: "5 projects",
    surfaces: [
      { kind: "paywall" as const, id: "winback", project: "a", routes: [], locales: [] },
      { kind: "paywall" as const, id: "onboarding", project: "b", routes: [], locales: [] },
      { kind: "paywall" as const, id: "upsell", project: "c", routes: [], locales: [] },
    ],
  };

  it("searches paywalls by name and by the project they came from", () => {
    window.history.replaceState({}, "", "/");
    render(<StudioApp source={many} />);

    const search = screen.getByRole("searchbox", { name: "Search paywalls" });
    fireEvent.change(search, { target: { value: "wink" } });
    expect(screen.getByText(/Nothing matches/)).toBeDefined();

    fireEvent.change(search, { target: { value: "winback" } });
    expect(screen.getByText("winback")).toBeDefined();
    expect(screen.queryByText("onboarding")).toBeNull();

    fireEvent.change(search, { target: { value: "b" } });
    expect(screen.getByText("onboarding")).toBeDefined();
  });

  it("comes back to where you were reading, not to the top", () => {
    window.history.replaceState({}, "", "/");
    const { unmount } = render(<StudioApp source={many} />);

    const list = document.querySelector(".overflow-y-auto") as HTMLElement;
    fireEvent.scroll(list, { target: { scrollTop: 420 } });

    // opening a paywall unmounts the list; coming back must restore it
    unmount();
    window.history.replaceState({}, "", "/");
    render(<StudioApp source={many} />);

    expect((document.querySelector(".overflow-y-auto") as HTMLElement).scrollTop).toBe(420);
  });

  it("offers no search when there is nothing to search through", () => {
    window.history.replaceState({}, "", "/");
    render(<StudioApp source={source} />);

    expect(screen.queryByRole("searchbox", { name: "Search paywalls" })).toBeNull();
  });

  it("names the surface's own project in the editor, not the aggregate title", () => {
    window.history.replaceState({}, "", "/a/paywall/winback");
    render(<StudioApp source={many} />);

    expect(screen.getByText("a / winback")).toBeDefined();
    expect(screen.queryByText("5 projects / winback")).toBeNull();
  });
});

describe("StudioApp across projects", () => {
  const twoProjects = {
    title: "2 projects",
    previewUrl: buildPreviewPath,
    surfaces: [
      { kind: "paywall" as const, id: "pro", project: "minimal", routes: ["index"], locales: [] },
      { kind: "paywall" as const, id: "pro", project: "i18n", routes: ["index"], locales: ["en"] },
    ],
  };

  it("addresses identical ids by project, so each card opens its own paywall", () => {
    // Without the project segment both surfaces resolve to /paywall/pro and
    // every card renders whichever project happened to be first.
    const [first, second] = twoProjects.surfaces;
    expect(buildPreviewPath(first, {})).toBe("/preview/minimal/paywall/pro");
    expect(buildPreviewPath(second, {})).toBe("/preview/i18n/paywall/pro");
  });

  it("links each card at its own project-scoped path", () => {
    window.history.replaceState({}, "", "/");
    render(<StudioApp source={twoProjects} />);

    const hrefs = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"))
      .filter((href) => href?.includes("/paywall/pro"));
    expect(hrefs).toEqual(["/minimal/paywall/pro", "/i18n/paywall/pro"]);
  });

  it("opens the editor for a project-scoped path", () => {
    window.history.replaceState({}, "", "/i18n/paywall/pro");
    render(<StudioApp source={twoProjects} />);

    // the editor, not the list
    expect(screen.getByRole("combobox", { name: "Device" })).toBeDefined();
    const frame = screen.getAllByTitle("pro preview").at(-1);
    expect(frame?.getAttribute("src")).toContain("/preview/i18n/paywall/pro");
  });
});

describe("StudioApp", () => {
  it("lists surfaces grouped by kind with live miniatures", () => {
    render(<StudioApp source={source} />);

    expect(screen.getByText("chatgpt")).toBeDefined();
    expect(screen.getByText("Paywalls")).toBeDefined();
    expect(screen.getByText("Funnels")).toBeDefined();
    expect(screen.getByText("plus-upgrade")).toBeDefined();
    expect(screen.getByText("onboarding")).toBeDefined();
    const card = screen.getByText("plus-upgrade").closest("a");
    expect(card?.getAttribute("href")).toBe("/paywall/plus-upgrade");
  });

  it("opens the editor on card click with the bottom toolbar", () => {
    render(<StudioApp source={source} />);

    fireEvent.click(screen.getByText("plus-upgrade"));
    expect(window.location.pathname).toBe("/paywall/plus-upgrade");
    expect(screen.getByRole("combobox", { name: "Device" })).toBeDefined();
    expect(screen.getByRole("group", { name: "Theme" })).toBeDefined();
    // no context badges on the stage — the paywall stands alone
    expect(screen.queryByText("#208540")).toBeNull();
    expect(screen.getByLabelText("Device")).toBeDefined();
    // the open control pops a device-sized preview window
    const opener = vi.spyOn(window, "open").mockReturnValue(null);
    fireEvent.click(screen.getByRole("button", { name: "Open preview" }));
    expect(String(opener.mock.calls[0]?.[0])).toContain("/preview/paywall/plus-upgrade");
    expect(String(opener.mock.calls[0]?.[2])).toContain("width=402");
    opener.mockRestore();

    // the wordmark navigates home
    fireEvent.click(screen.getByText("Studio"));
    expect(window.location.pathname).toBe("/");
    expect(screen.getByText("Paywalls")).toBeDefined();
  });

  it("deep-links straight into the editor", () => {
    window.history.replaceState({}, "", "/funnel/onboarding");
    render(<StudioApp source={source} />);

    expect(screen.getByRole("combobox", { name: "Device" })).toBeDefined();
    // single locale → no locale select
    expect(screen.queryByRole("combobox", { name: "Locale" })).toBeNull();
  });

  it("responsive mode exposes editable dimensions that drive the frame", () => {
    window.history.replaceState({}, "", "/paywall/plus-upgrade");
    render(<StudioApp source={source} />);

    // device presets show no size inputs
    expect(screen.queryByRole("spinbutton", { name: "Preview width" })).toBeNull();

    fireEvent.change(screen.getByRole("combobox", { name: "Device" }), {
      target: { value: "responsive" },
    });
    const width = screen.getByRole("spinbutton", { name: "Preview width" });
    // free typing below the minimum stays put until focus leaves
    fireEvent.change(width, { target: { value: "6" } });
    expect((width as HTMLInputElement).value).toBe("6");
    fireEvent.change(width, { target: { value: "600" } });
    fireEvent.blur(width);
    // double-buffered: the newest frame carries the new size
    const frame = screen.getAllByTitle("plus-upgrade preview").at(-1);
    expect(frame?.getAttribute("width")).toBe("600");
    // responsive is layout-only: no simulated hardware in the preview URL
    expect(frame?.getAttribute("src")).not.toContain("sw_device");
  });

  it("simulates SDK variables from the side panel and carries them in the preview URL", () => {
    window.history.replaceState({}, "", "/paywall/plus-upgrade");
    render(<StudioApp source={source} />);

    // controls live in the panel, opened from the toolbar
    expect(screen.queryByRole("textbox", { name: "user.subscriptionStatus" })).toBeNull();
    const toggle = screen.getByRole("button", { name: /Variables/ });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    // every group the SDK delivers, and nothing from the v4 template system
    const panel = within(document.querySelector("aside") as HTMLElement);
    for (const group of ["User", "Device", "Params", "Products"]) {
      expect(panel.getByText(group)).toBeDefined();
    }
    expect(panel.queryByText("State")).toBeNull();
    expect(panel.queryByText("Element")).toBeNull();

    // the set is fixed — a variable is named by how a paywall reads it
    fireEvent.click(panel.getByRole("button", { name: /^User/ }));
    const field = screen.getByRole("textbox", { name: "user.subscriptionStatus" });
    expect((field as HTMLInputElement).value).toBe("INACTIVE");
    fireEvent.change(field, { target: { value: "ACTIVE" } });

    const frame = screen.getAllByTitle("plus-upgrade preview").at(-1);
    expect(frame?.getAttribute("src")).toContain(
      encodeURIComponent('{"subscriptionStatus":"ACTIVE"}'),
    );

    fireEvent.click(screen.getByRole("button", { name: "Close variables" }));
    expect(screen.queryByRole("textbox", { name: "user.subscriptionStatus" })).toBeNull();
  });

  it("offers no way to invent a variable — the SDK decides what exists", () => {
    window.history.replaceState({}, "", "/paywall/plus-upgrade");
    render(<StudioApp source={source} />);
    fireEvent.click(screen.getByRole("button", { name: /Variables/ }));

    const panel = within(document.querySelector("aside") as HTMLElement);
    fireEvent.click(panel.getByRole("button", { name: /^User/ }));
    expect(panel.queryByRole("button", { name: "+ Add" })).toBeNull();
    expect(panel.queryByRole("textbox", { name: /key$/ })).toBeNull();
  });

  it("opens with every group collapsed — the panel is a menu before it is a form", () => {
    window.history.replaceState({}, "", "/paywall/plus-upgrade");
    render(<StudioApp source={source} />);
    fireEvent.click(screen.getByRole("button", { name: /Variables/ }));

    const panel = within(document.querySelector("aside") as HTMLElement);
    for (const group of ["User", "Device", "Params", "Products"]) {
      expect(
        panel.getByRole("button", { name: new RegExp(`^${group}`) }).getAttribute("aria-expanded"),
      ).toBe("false");
    }
    expect(panel.queryByRole("textbox")).toBeNull();

    // opening one leaves the rest folded
    fireEvent.click(panel.getByRole("button", { name: /^Device/ }));
    expect(panel.getByRole("textbox", { name: "device.platform" })).toBeDefined();
    expect(panel.queryByRole("textbox", { name: "user.subscriptionStatus" })).toBeNull();
  });

  it("carries trial eligibility into the preview, so trial copy can be seen either way", () => {
    window.history.replaceState({}, "", "/paywall/plus-upgrade");
    render(<StudioApp source={source} />);

    const frame = () => screen.getAllByTitle("plus-upgrade preview").at(-1)?.getAttribute("src");
    expect(frame()).not.toContain("sw_trial");

    fireEvent.click(screen.getByRole("switch", { name: "Trial eligibility" }));
    expect(frame()).toContain("sw_trial=1");
  });

  it("edits a boolean with a switch, and keeps it a boolean", () => {
    window.history.replaceState({}, "", "/paywall/plus-upgrade");
    render(<StudioApp source={source} />);
    fireEvent.click(screen.getByRole("button", { name: /Variables/ }));

    const panel = within(document.querySelector("aside") as HTMLElement);
    fireEvent.click(panel.getByRole("button", { name: /^Params/ }));

    const toggle = panel.getByRole("switch", { name: "params.isFeatureGatable" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(panel.queryByRole("textbox", { name: "params.isFeatureGatable" })).toBeNull();

    fireEvent.click(toggle);
    const frame = screen.getAllByTitle("plus-upgrade preview").at(-1);
    expect(frame?.getAttribute("src")).toContain(encodeURIComponent('{"isFeatureGatable":true}'));
  });

  it("shows a variable with no value as empty, never as the word undefined", () => {
    window.history.replaceState({}, "", "/paywall/plus-upgrade");
    render(
      <StudioApp
        source={{
          ...source,
          samples: { ...source.samples, user: { plan: undefined } } as typeof source.samples,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Variables/ }));

    const panel = within(document.querySelector("aside") as HTMLElement);
    fireEvent.click(panel.getByRole("button", { name: /^User/ }));

    expect((panel.getByRole("textbox", { name: "user.plan" }) as HTMLInputElement).value).toBe("");
    expect(document.querySelector("aside")?.textContent).not.toContain("undefined");
  });

  it("says on a collapsed group how many of its variables are simulated", () => {
    window.history.replaceState({}, "", "/paywall/plus-upgrade");
    render(<StudioApp source={source} />);
    fireEvent.click(screen.getByRole("button", { name: /Variables/ }));

    const panel = within(document.querySelector("aside") as HTMLElement);
    const user = () => panel.getByRole("button", { name: /^User/ });
    fireEvent.click(user());
    fireEvent.change(screen.getByRole("textbox", { name: "user.subscriptionStatus" }), {
      target: { value: "ACTIVE" },
    });
    fireEvent.click(user());

    expect(panel.queryByRole("textbox")).toBeNull();
    expect(user().textContent).toContain("1 set");
  });

  it("shows only the products this paywall declares, and edits one slot at a time", async () => {
    window.history.replaceState({}, "", "/paywall/plus-upgrade");
    await withCatalogue(
      { pro_5999_year: { price: "$59.99" }, pro_999_month: { price: "$9.99" } },
      <StudioApp source={shippable} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Variables/ }));

    const panel = within(document.querySelector("aside") as HTMLElement);
    fireEvent.click(panel.getByRole("button", { name: /^Products/ }));

    // pro_999_month is in the catalogue but this paywall does not declare it.
    expect(screen.getByRole("textbox", { name: "products.annual.price" })).toBeDefined();
    expect(screen.queryByRole("textbox", { name: "products.monthly.price" })).toBeNull();

    fireEvent.change(screen.getByRole("textbox", { name: "products.annual.price" }), {
      target: { value: "$19.99" },
    });
    const frame = screen.getAllByTitle("plus-upgrade preview").at(-1);
    expect(frame?.getAttribute("src")).toContain(
      encodeURIComponent('{"annual":{"price":"$19.99"}}'),
    );
  });
});

describe("a product Superwall has no record of", () => {
  it("says so, and blocks publishing until it exists", async () => {
    window.history.replaceState({}, "", "/paywall/plus-upgrade");
    await withCatalogue({ something_else: { price: "$1.00" } }, <StudioApp source={shippable} />);

    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("pro_5999_year")).toBeDefined();
    expect(screen.getByRole("button", { name: "Push" })).toHaveProperty("disabled", true);
  });

  it("still lets you look at the paywall, with the variables simply undefined", async () => {
    window.history.replaceState({}, "", "/paywall/plus-upgrade");
    await withCatalogue({}, <StudioApp source={shippable} />);

    fireEvent.click(screen.getByRole("button", { name: "View anyway" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByTitle("plus-upgrade preview").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Variables/ }));
    const panel = within(document.querySelector("aside") as HTMLElement);
    fireEvent.click(panel.getByRole("button", { name: /^Products/ }));
    expect(panel.queryByRole("textbox", { name: /^products\./ })).toBeNull();

    // dismissing is about looking, never about shipping
    expect(screen.getByRole("button", { name: "Push" })).toHaveProperty("disabled", true);
  });

  it("does not accuse a paywall before the catalogue has arrived", () => {
    window.history.replaceState({}, "", "/paywall/plus-upgrade");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    render(<StudioApp source={shippable} />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
