import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Tooltip } from "../../src/components/Tooltip";

afterEach(cleanup);

const trigger = () => screen.getByRole("button");

describe("the studio's tooltip", () => {
  it("renders the control bare when there is nothing to explain", () => {
    render(
      <Tooltip>
        <button type="button">Push</button>
      </Tooltip>,
    );

    expect(screen.queryByRole("tooltip")).toBeNull();
    // No wrapper either — a hintless tooltip must not change the layout around
    // the control it wraps.
    expect(trigger().parentElement?.tagName).not.toBe("SPAN");
  });

  it("shows and hides on hover", () => {
    render(
      <Tooltip hint="Promote a version first">
        <button type="button">Download</button>
      </Tooltip>,
    );
    const wrapper = trigger().parentElement!;

    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseEnter(wrapper);
    expect(screen.getByRole("tooltip").textContent).toBe("Promote a version first");

    fireEvent.mouseLeave(wrapper);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows and hides on keyboard focus, so it is not mouse-only", () => {
    render(
      <Tooltip hint="Promote a version first">
        <button type="button">Download</button>
      </Tooltip>,
    );

    fireEvent.focus(trigger());
    expect(screen.getByRole("tooltip")).toBeTruthy();

    fireEvent.blur(trigger());
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
