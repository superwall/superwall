import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VariablesPanel } from "../../src/components/panels/VariablesPanel";

const groups = {
  user: [{ path: "user.firstName", value: "Ada" }],
  device: [
    { path: "device.locale", value: "en_US" },
    { path: "device.osVersion", value: "26.0" },
  ],
};

describe("searching variables", () => {
  it("shows only the matching variables, with their groups opened", () => {
    render(<VariablesPanel overrides={{}} groups={groups} onChange={() => {}} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search variables" }), {
      target: { value: "LOCALE" },
    });
    expect(screen.getByLabelText("device.locale")).toBeTruthy();
    expect(screen.queryByLabelText("device.osVersion")).toBeNull();
    expect(screen.queryByText("User")).toBeNull();
  });

  it("says when nothing matches", () => {
    render(<VariablesPanel overrides={{}} groups={groups} onChange={() => {}} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search variables" }), {
      target: { value: "nope" },
    });
    expect(screen.getByText("No variables match.")).toBeTruthy();
  });
});
