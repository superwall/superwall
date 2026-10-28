import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SurfaceEditor } from "../../src/screens/SurfaceEditor";
import {
  STUDIO_COMMAND_TYPES,
  type StudioCommandType,
  type StudioHandle,
} from "../../src/lib/commands";
import { snapshotPreviewUrl } from "../../src/lib/preview";
import { StudioHostProvider } from "../../src/lib/studio-host";
import type { StudioSource, StudioSurface } from "../../src/lib/surfaces";

/**
 * Everything a person can change in the editor is something a host (the
 * agent beside it) can do through a `StudioCommand`. This renders the editor
 * with every control showing and fails on any control that maps to no
 * command and has no reason it is the person's alone.
 */
type Mapping = StudioCommandType | { personOnly: string };

const CONTROLS: readonly (readonly [RegExp, Mapping])[] = [
  [/^Zoom (in|out)$/, "zoom"],
  [/^Fit to view$/, "zoom"],
  [/^Device$/, "device"],
  [/^Preview (width|height)$/, "size"],
  [/^Resize chat/, { personOnly: "the host's own panel" }],
  [/^Resize( |$)/, "size"],
  [/^Rotate device$/, "orientation"],
  [/^(Light|Dark)$/, "theme"],
  [/^Locale$/, "locale"],
  [/^Introductory offer$/, "introductoryOffer"],
  [/^Variables/, "variablesPanel"],
  [/^Close variables$/, "variablesPanel"],
  [/^Reset (user|device|params|products)\./, "variable"],
  [/^(user|device|params|products)\./, "variable"],
  [/^Version$/, "version"],
  [/^Compare/, "compare"],
  [/^Open .+ · draft$/, "select"],
  [/^Stop comparing /, "compareRemove"],
  [/^Reload preview$/, "reload"],
  [/^Preview$/, "previewOnDevice"],
  [
    /^Search variables$/,
    { personOnly: "filters the Variables panel's rows; nothing on stage changes" },
  ],
  [
    /^(User|Device|Params|Products)\d/,
    { personOnly: "folds a group of the Variables panel's rows" },
  ],
  [
    /^Open preview$/,
    { personOnly: "opens a new window, which a browser allows only from a click" },
  ],
  [/^Download screenshot$/, { personOnly: "saves a file to the person's machine" }],
  [
    /^(Promote|Roll back|Push|Publish|Choose action)/,
    { personOnly: "ships the paywall: the agent's own publish tools ask for approval" },
  ],
  [/^Studio$/, { personOnly: "leaves the editor for the host's home" }],
];

/** The menus' rows, by the menu they sit in. */
const MENU_ROWS: Record<string, Mapping> = {
  Compare: "compare",
  Version: "version",
};

const AGENT_ONLY: Partial<Record<StudioCommandType, string>> = {
  resetVariables: "the panel resets one row at a time; this is all of them at once",
  compareAdd: "a Compare menu row adds what it names",
  compareSwap: "removing one compared option and adding another",
};

const nameOf = (element: Element): string =>
  (element.getAttribute("aria-label") ?? element.textContent ?? "").trim();

const controls = (root: ParentNode = document) =>
  [...root.querySelectorAll("button, select, input, [role=separator], a[href]")].filter(
    (element) => !element.closest("[data-menu-popup]") || root !== document,
  );

const mapped = (name: string): Mapping | undefined =>
  CONTROLS.find(([pattern]) => pattern.test(name))?.[1];

const surface: StudioSurface = {
  kind: "paywall",
  id: "variant-a",
  label: "v2 · Live",
  version: 2,
  routes: [],
  locales: ["en", "de"],
  products: { annual: "pro_year" },
  paywallId: "1",
  origin: { paywallId: "9", url: "https://editor.test/9" },
};

const source: StudioSource = {
  title: "Variant A",
  surfaces: [surface],
  previewUrl: snapshotPreviewUrl(() => "https://cdn.test/2.html"),
  standaloneUrl: () => "https://cdn.test/2.html",
  previewLink: async () => "https://dash.test/preview",
  screenshotUrl: async () => undefined,
  drafts: [
    { key: "variant-b", label: "variant-b · draft", url: "https://agent.test/b" },
    { key: "variant-c", label: "variant-c · draft", url: "https://agent.test/c" },
  ],
  selectDraft: () => {},
  actions: {
    offered: ["promote"],
    run: vi.fn(),
    pick: () => {},
    status: async () => ({
      paywallId: "1",
      versions: [
        { version: 3, url: "https://cdn.test/3.html", live: false },
        { version: 2, url: "https://cdn.test/2.html", live: true },
      ],
    }),
  },
};

describe("every control in the editor is a command", () => {
  it("maps each control on screen, each menu row, and each command", async () => {
    const handle = React.createRef<StudioHandle>();
    render(
      <StudioHostProvider mode="hosted" home={{ href: "/", navigate: () => {} }}>
        <SurfaceEditor
          ref={handle}
          source={source}
          surface={surface}
          samples={{ products: { pro_year: { price: "$9.99" } }, user: { name: "Ada" } }}
          panel={{ open: true, label: "Chat", content: null }}
        />
      </StudioHostProvider>,
    );
    await act(async () => {});
    // Show the controls that only appear in some states.
    let running: Promise<unknown> | undefined;
    act(() => {
      running = handle.current?.run([
        { type: "device", device: "responsive" },
        { type: "variablesPanel", open: true },
        { type: "variable", path: "user.name", value: "Grace" },
      ]);
    });
    await act(async () => {
      await running;
    });
    for (const group of screen.getAllByRole("button", { expanded: false })) {
      if (/^(User|Device|Params|Products)\d/.test(nameOf(group))) fireEvent.click(group);
    }

    const seen = new Set<StudioCommandType>();
    const unmapped: string[] = [];
    const record = (name: string, mapping: Mapping | undefined) => {
      if (mapping === undefined) unmapped.push(name);
      else if (typeof mapping === "string") seen.add(mapping);
    };

    for (const element of controls()) record(nameOf(element), mapped(nameOf(element)));

    for (const [menu, mapping] of Object.entries(MENU_ROWS)) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${menu}`) }));
      const popup = document.querySelector("[data-menu-popup]");
      expect(popup, `${menu} opens a menu`).not.toBeNull();
      for (const element of controls(popup!)) {
        const name = nameOf(element);
        record(name, /^Search /.test(name) ? { personOnly: "filters the menu" } : mapping);
      }
      fireEvent.keyDown(window, { key: "Escape" });
    }

    expect(
      unmapped,
      "controls with no command; add one, or say why it is the person's alone",
    ).toEqual([]);
    const missing = STUDIO_COMMAND_TYPES.filter((type) => !seen.has(type) && !AGENT_ONLY[type]);
    expect(missing, "commands with no control on screen and no reason").toEqual([]);
  }, 30_000);
});
