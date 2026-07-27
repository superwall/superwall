import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VariablesPanel } from "../src/components/VariablesPanel";
import type { VariablesSchema } from "../src/lib/types";

const schema: VariablesSchema = {
  defaultPlan: { type: "enum", values: ["go", "plus"], default: "plus" },
  layout: { type: "enum", values: ["a", "b", "c", "d"], default: "a", label: "Layout" },
  showWebCheckout: { type: "boolean", default: true },
  headline: { type: "string", default: "Go further" },
  maxFeatures: { type: "number", default: 6, min: 1, max: 12 },
};

describe("VariablesPanel", () => {
  it("renders the right control per spec type", () => {
    render(<VariablesPanel schema={schema} values={{}} onChange={() => {}} />);

    // enums are dropdowns — the same control as the toolbar
    expect(screen.getByRole("combobox", { name: "defaultPlan" })).toBeDefined();
    expect(screen.getByRole("combobox", { name: "Layout" })).toBeDefined();
    expect(screen.getByRole("switch", { name: "showWebCheckout" })).toBeDefined();
    expect(screen.getByRole("textbox", { name: "headline" })).toBeDefined();
    expect(screen.getByRole("spinbutton", { name: "maxFeatures" })).toBeDefined();
  });

  it("emits overrides and drops keys set back to their default", () => {
    const onChange = vi.fn();
    render(<VariablesPanel schema={schema} values={{}} onChange={onChange} />);

    fireEvent.change(screen.getByRole("combobox", { name: "defaultPlan" }), {
      target: { value: "go" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ defaultPlan: "go" });

    fireEvent.click(screen.getByRole("switch", { name: "showWebCheckout" }));
    expect(onChange).toHaveBeenLastCalledWith({ showWebCheckout: false });
  });

  it("returns to defaults via the reset affordance", () => {
    const onChange = vi.fn();
    render(<VariablesPanel schema={schema} values={{ defaultPlan: "go" }} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Reset defaultPlan" }));
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it("keeps number overrides numeric", () => {
    const onChange = vi.fn();
    render(<VariablesPanel schema={schema} values={{}} onChange={onChange} />);

    fireEvent.change(screen.getByRole("spinbutton", { name: "maxFeatures" }), {
      target: { value: "9" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ maxFeatures: 9 });
  });
});
