import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActionMenu, type ActionProgress } from "../../../src/components/menus/ActionMenu";
import type { Promotion } from "../../../src/lib/promotion";
import type { StudioActionName, StudioVersion } from "../../../src/lib/surfaces";

const versions: StudioVersion[] = [
  { version: 13, url: "https://cdn.test/13.html", live: false, pushedAt: "2026-09-02T00:00:00Z" },
  { version: 12, url: "https://cdn.test/12.html", live: true },
  { version: 11, url: "https://cdn.test/11.html", live: false },
];

const LOCAL: readonly StudioActionName[] = ["push", "promote", "publish"];

const mount = (
  promotion: Promotion,
  over: {
    offered?: readonly StudioActionName[];
    progress?: ActionProgress;
    blocked?: string;
    onRun?: (action: StudioActionName) => void;
    onBlocked?: () => void;
  } = {},
) => {
  const onRun = over.onRun ?? vi.fn();
  render(
    <ActionMenu
      offered={over.offered ?? LOCAL}
      promotion={promotion}
      progress={over.progress}
      blocked={over.blocked}
      onRun={onRun}
      onBlocked={over.onBlocked}
    />,
  );
  return onRun;
};

const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "Choose action" }));

describe("the promote entry", () => {
  it("reads Promote while the target is newer than what is live", () => {
    mount({ target: 13, live: 12, versions });
    openMenu();
    fireEvent.click(screen.getByText("Promote"));
    expect(screen.getByRole("button", { name: "Promote" })).toBeDefined();
  });

  it("reads Roll back once the target is older than what is live, and runs the same action", () => {
    const onRun = mount({ target: 11, live: 12, versions });
    openMenu();
    expect(screen.getByText("Make v11 live again, replacing v12")).toBeDefined();
    fireEvent.click(screen.getByText("Roll back"));
    fireEvent.click(screen.getByRole("button", { name: "Roll back" }));
    expect(onRun).toHaveBeenCalledWith("promote");
  });

  it("puts a version menu beside the group, and the pick drives the label", () => {
    const pick = vi.fn();
    mount({ target: 13, live: 12, versions, pick });
    const picker = screen.getByRole("button", { name: "Version" });
    expect(picker.textContent).toBe("v13");
    fireEvent.click(picker);
    const items = [...document.querySelectorAll("[data-menu-list] button")].map(
      (item) => item.querySelector("span span")?.textContent,
    );
    expect(items).toEqual(["v13", "v12 · Live", "v11"]);
    expect(screen.getByText("What SDKs receive today")).toBeDefined();
    expect(screen.getAllByText(/^Pushed /).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("v11"));
    expect(pick).toHaveBeenCalledWith(11);
    expect(document.querySelector("[data-menu-list]")).toBeNull();
    openMenu();
    expect(screen.queryByText("Versions")).toBeNull();
  });

  it("names a target the list does not carry, and closes the version menu on Escape", () => {
    mount({ target: 9, live: 12, versions, pick: vi.fn() });
    const picker = screen.getByRole("button", { name: "Version" });
    expect(picker.textContent).toBe("v9");
    fireEvent.click(picker);
    expect(document.querySelector("[data-menu-list]")).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.querySelector("[data-menu-list]")).toBeNull();
  });

  it("shows no picker when the host offers none, or nothing is pushed", () => {
    mount({ target: 13, live: 12, versions, pick: undefined });
    expect(screen.queryByRole("button", { name: "Version" })).toBeNull();
    openMenu();
    expect(screen.getByText("Make v13 live, replacing v12")).toBeDefined();
  });

  it("shows no picker with nothing pushed, even for a host that can pick", () => {
    mount({ target: undefined, live: undefined, versions: [], pick: vi.fn() });
    expect(screen.queryByRole("button", { name: "Version" })).toBeNull();
  });

  it("refuses to promote the live version, and says so instead of opening the products dialog", () => {
    const onRun = vi.fn();
    const onBlocked = vi.fn();
    mount({ target: 12, live: 12, versions }, { onRun, onBlocked, blocked: "no products" });
    openMenu();
    fireEvent.click(screen.getByText("Promote"));

    const button = screen.getByRole("button", { name: "Promote" });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.mouseEnter(button.parentElement!.parentElement!);
    expect(screen.getByRole("tooltip").textContent).toBe("v12 is already live");
    fireEvent.click(button);
    expect(onRun).not.toHaveBeenCalled();
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it("keeps the products block on push, where a build reads the config", () => {
    const onRun = vi.fn();
    const onBlocked = vi.fn();
    mount({ target: 13, live: 12, versions }, { onRun, onBlocked, blocked: "no products" });
    fireEvent.click(screen.getByRole("button", { name: "Push" }));
    expect(onBlocked).toHaveBeenCalledOnce();
    expect(onRun).not.toHaveBeenCalled();
  });

  it("says nothing is pushed rather than offering an empty promote", () => {
    mount({ target: undefined, live: undefined, versions: [] });
    openMenu();
    expect(screen.getByText("Make the latest push live")).toBeDefined();
    fireEvent.click(screen.getByText("Promote"));
    expect(screen.getByRole("button", { name: "Promote" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("a host that only promotes", () => {
  it("shows the picker and one button with no chooser, labelled by direction", () => {
    const pick = vi.fn();
    const onRun = mount({ target: 11, live: 12, versions, pick }, { offered: ["promote"] });
    expect(screen.queryByRole("button", { name: "Choose action" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Version" }));
    fireEvent.click(screen.getByText("v13"));
    expect(pick).toHaveBeenCalledWith(13);
    fireEvent.click(screen.getByRole("button", { name: "Roll back" }));
    expect(onRun).toHaveBeenCalledWith("promote");
  });

  it("promotes a newer version from the same button", () => {
    mount({ target: 13, live: 12, versions }, { offered: ["promote"] });
    expect(screen.getByRole("button", { name: "Promote" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Push" })).toBeNull();
  });
});

describe("while it runs", () => {
  it("says Rolling back on the button and the panel, and names the version the step lands on", () => {
    mount(
      { target: 11, live: 12, versions },
      {
        offered: ["promote"],
        progress: { action: "promote", steps: { link: "done", promote: "active" } },
      },
    );
    expect(screen.getAllByText("Rolling back…")).toHaveLength(2);
    expect(screen.getByText("Roll back to v11")).toBeDefined();
    expect(screen.getByRole("button", { name: /Rolling back/ }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("keeps the promote step named Promote to live inside a publish", () => {
    mount(
      { target: 11, live: 12, versions },
      { progress: { action: "publish", steps: { link: "done", build: "active" } } },
    );
    expect(screen.getByText("Promote to live")).toBeDefined();
    expect(screen.getAllByText("Publishing…")).toHaveLength(2);
  });

  it("remembers the direction it started with, even as the live version moves under it", () => {
    const view = render(
      <ActionMenu
        offered={["promote"]}
        promotion={{ target: 11, live: 12, versions }}
        progress={undefined}
        onRun={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Roll back" }));
    view.rerender(
      <ActionMenu
        offered={["promote"]}
        promotion={{ target: 11, live: 12, versions }}
        progress={{ action: "promote", steps: { link: "done", promote: "active" } }}
        onRun={() => {}}
      />,
    );
    expect(screen.getAllByText("Rolling back…")).toHaveLength(2);
    expect(screen.getByText("Roll back to v11")).toBeDefined();

    view.rerender(
      <ActionMenu
        offered={["promote"]}
        promotion={{ target: 13, live: 11, versions }}
        progress={{ action: "promote", steps: { link: "done", promote: "done" } }}
        onRun={() => {}}
      />,
    );
    expect(screen.getByText("Roll back complete")).toBeDefined();
    expect(screen.getByText("Roll back to v11")).toBeDefined();
  });

  it("reports a failed rollback as one", () => {
    const view = render(
      <ActionMenu
        offered={["promote"]}
        promotion={{ target: 11, live: 12, versions }}
        progress={undefined}
        onRun={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Roll back" }));
    view.rerender(
      <ActionMenu
        offered={["promote"]}
        promotion={{ target: 11, live: 12, versions }}
        progress={{ action: "promote", steps: { link: "done", promote: "failed" }, error: "nope" }}
        onRun={() => {}}
      />,
    );
    expect(screen.getByText("Roll back failed")).toBeDefined();
    expect(screen.getByRole("alert").textContent).toBe("nope");
  });
});
