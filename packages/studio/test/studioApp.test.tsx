import { act, fireEvent, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { buildPreviewPath, surfacePath } from "../src/lib/preview";
import { StudioApp } from "../src/StudioApp";
import type { StudioSource } from "../src/lib/surfaces";

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
    {
      kind: "funnel",
      id: "onboarding",
      routes: ["/", "/step-2"],
      locales: ["en"],
      platforms: ["ios", "android"],
    },
  ],
  diagnostics: [],
  samples: {
    device: { platform: "iOS" },
    user: { subscriptionStatus: "INACTIVE" },
    params: { event_name: "campaign_trigger", $is_feature_gatable: false },
  },
  capabilities: { actions: true },
  previewUrl: buildPreviewPath,
  standaloneUrl: surfacePath,
};

const hostOf = (frame: HTMLElement | undefined) => {
  if (!(frame instanceof HTMLIFrameElement) || !frame.contentWindow) {
    throw new Error("no hosted frame");
  }
  const post = vi.spyOn(frame.contentWindow, "postMessage").mockImplementation(() => {});
  return () =>
    post.mock.calls.map(([message]) => {
      if (typeof message !== "string") throw new Error("host must post strings");
      const envelope: { payload: { events: Record<string, unknown>[] } } = JSON.parse(message);
      return envelope.payload.events;
    });
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
    expect(buildPreviewPath(first)).toBe("/preview/minimal/paywall/pro?transport=editor");
    expect(buildPreviewPath(second)).toBe("/preview/i18n/paywall/pro?transport=editor");
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
    expect(screen.getByText("· ios · android")).toBeDefined();
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
    expect(String(opener.mock.calls[0]?.[0])).toBe("/paywall/plus-upgrade");
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
    const sent = hostOf(screen.getAllByTitle("plus-upgrade preview").at(-1));
    fireEvent.change(field, { target: { value: "ACTIVE" } });

    // the edit reaches the paywall as template_variables, not a reload
    expect(screen.getAllByTitle("plus-upgrade preview")).toHaveLength(1);
    expect(sent().at(-1)).toEqual([
      expect.objectContaining({
        event_name: "template_variables",
        variables: expect.objectContaining({
          user: expect.objectContaining({ subscriptionStatus: "ACTIVE" }),
        }),
      }),
    ]);

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

  it("flips introductory offer eligibility through the prefix, so both copy variants can be seen", () => {
    window.history.replaceState({}, "", "/paywall/plus-upgrade");
    render(<StudioApp source={source} />);

    const sent = hostOf(screen.getAllByTitle("plus-upgrade preview").at(-1));
    const toggle = screen.getByRole("switch", { name: "Introductory offer" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);
    expect(sent().at(-1)).toEqual([
      { event_name: "template_substitutions_prefix", prefix: "freeTrial" },
    ]);
    expect(screen.getAllByTitle("plus-upgrade preview")).toHaveLength(1);
  });

  it("edits a boolean with a switch, and keeps it a boolean", () => {
    window.history.replaceState({}, "", "/paywall/plus-upgrade");
    render(<StudioApp source={source} />);
    fireEvent.click(screen.getByRole("button", { name: /Variables/ }));

    const panel = within(document.querySelector("aside") as HTMLElement);
    fireEvent.click(panel.getByRole("button", { name: /^Params/ }));

    const toggle = panel.getByRole("switch", { name: "params.$is_feature_gatable" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(panel.queryByRole("textbox", { name: "params.$is_feature_gatable" })).toBeNull();

    const sent = hostOf(screen.getAllByTitle("plus-upgrade preview").at(-1));
    fireEvent.click(toggle);
    expect(sent().at(-1)).toEqual([
      expect.objectContaining({
        event_name: "template_variables",
        variables: expect.objectContaining({
          params: expect.objectContaining({ $is_feature_gatable: true }),
        }),
      }),
    ]);
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

    const sent = hostOf(screen.getAllByTitle("plus-upgrade preview").at(-1));
    fireEvent.change(screen.getByRole("textbox", { name: "products.annual.price" }), {
      target: { value: "$19.99" },
    });
    expect(sent().at(-1)).toEqual([
      expect.objectContaining({
        event_name: "template_variables",
        variables: expect.objectContaining({ products: [{ annual: { price: "$19.99" } }] }),
      }),
    ]);
  });
});

describe("a product Superwall has no record of", () => {
  it("says so, and blocks publishing until it exists", async () => {
    window.history.replaceState({}, "", "/paywall/plus-upgrade");
    await withCatalogue({ something_else: { price: "$1.00" } }, <StudioApp source={shippable} />);

    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("pro_5999_year")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "View anyway" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Push" }));
    expect(screen.getByRole("dialog")).toBeDefined();
    const calls = vi.mocked(fetch).mock.calls.map(([input]) => String(input));
    expect(calls.some((url) => url.includes("/__studio/action"))).toBe(false);
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
    fireEvent.click(screen.getByRole("button", { name: "Push" }));
    expect(screen.getByRole("dialog")).toBeDefined();
    const calls = vi.mocked(fetch).mock.calls.map(([input]) => String(input));
    expect(calls.some((url) => url.includes("/__studio/action"))).toBe(false);
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

describe("device mode", () => {
  it("titles the bar Preview and opens cards in the hosted editor, like everywhere else", () => {
    window.history.replaceState({}, "", "/device");
    render(<StudioApp source={source} device />);

    expect(screen.getByText("Preview")).toBeDefined();
    expect(screen.queryByText("Studio")).toBeNull();
    expect(screen.queryByText(/simulated SDK host/)).toBeNull();

    const card = screen.getByText("plus-upgrade").closest("a");
    expect(card?.getAttribute("href")).toBe("/paywall/plus-upgrade");
    fireEvent.click(screen.getByText("plus-upgrade"));
    expect(window.location.pathname).toBe("/paywall/plus-upgrade");
    expect(screen.getByRole("combobox", { name: "Device" })).toBeDefined();
    const frame = screen.getAllByTitle("plus-upgrade preview").at(-1);
    expect(frame?.getAttribute("src")).toBe("/preview/paywall/plus-upgrade?transport=editor");
  });

  it("asks for the scheme on click when nothing knows it, then remembers it", () => {
    window.history.replaceState({}, "", "/device");
    window.localStorage.clear();
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("exampleapp");
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      assign,
    } as unknown as Location);
    render(<StudioApp source={source} device />);

    expect(screen.queryByLabelText("Edit app URL scheme")).toBeNull();
    fireEvent.click(screen.getByText("Open In App"));

    expect(prompt).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith(
      `exampleapp://?superwall_dev=${encodeURIComponent(window.location.origin)}`,
    );
    expect(window.localStorage.getItem("superwall-device-scheme")).toBe("exampleapp");
    // and having answered once, the link is live and editable
    expect(screen.getByLabelText("Edit app URL scheme")).toBeDefined();
    vi.restoreAllMocks();
  });

  it("links straight out when the project payload carries the scheme", () => {
    window.history.replaceState({}, "", "/device");
    window.localStorage.clear();
    render(<StudioApp source={{ ...source, scheme: "detectedapp" }} device />);

    const link = screen.getByText("Open In App").closest("a");
    expect(link?.getAttribute("href")).toBe(
      `detectedapp://?superwall_dev=${encodeURIComponent(window.location.origin)}`,
    );
    expect(screen.getByLabelText("Edit app URL scheme")).toBeDefined();
  });

  it("lets a wrong scheme be corrected with the pencil", () => {
    window.history.replaceState({}, "", "/device");
    window.localStorage.clear();
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("rightapp");
    render(<StudioApp source={{ ...source, scheme: "wrongapp" }} device />);

    fireEvent.click(screen.getByLabelText("Edit app URL scheme"));
    expect(prompt).toHaveBeenCalledWith(expect.any(String), "wrongapp");
    expect(screen.getByText("Open In App").closest("a")?.getAttribute("href")).toBe(
      `rightapp://?superwall_dev=${encodeURIComponent(window.location.origin)}`,
    );
    vi.restoreAllMocks();
  });

  it("never routes into the editor even when the path looks like one", () => {
    window.history.replaceState({}, "", "/device");
    render(<StudioApp source={source} device />);
    expect(screen.getByText("Paywalls")).toBeDefined();
    expect(screen.queryByRole("group", { name: "Theme" })).toBeNull();
  });
});

describe("the surface list's own states", () => {
  it("shows the project's problems above the surfaces", async () => {
    await withCatalogue(
      undefined,
      <StudioApp
        source={{
          ...shippable,
          diagnostics: ["paywalls/pro has two files claiming index", "funnels/quiz has no config"],
        }}
      />,
    );

    expect(screen.getByText(/two files claiming index/)).toBeTruthy();
    expect(screen.getByText(/has no config/)).toBeTruthy();
  });

  it("says how to make the first paywall when a project has none", async () => {
    await withCatalogue(
      undefined,
      <StudioApp source={{ ...shippable, surfaces: [], diagnostics: [] }} />,
    );

    expect(screen.getByText(/No paywalls yet/)).toBeTruthy();
    expect(screen.getByText(/superwall\/paywalls/)).toBeTruthy();
  });
});
