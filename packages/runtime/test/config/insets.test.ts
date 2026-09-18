import { describe, expect, it } from "vitest";
import { insetsOf } from "../../src/config/insets";

describe("insetsOf", () => {
  it("leaves every edge to the safe area by default", () => {
    const safeArea = { top: undefined, right: undefined, bottom: undefined, left: undefined };
    expect(insetsOf(undefined)).toEqual(safeArea);
    expect(insetsOf("safe-area")).toEqual(safeArea);
  });

  it("applies one value to all four edges", () => {
    expect(insetsOf("none")).toEqual({ top: "0px", right: "0px", bottom: "0px", left: "0px" });
    expect(insetsOf(12)).toEqual({ top: "12px", right: "12px", bottom: "12px", left: "12px" });
    expect(insetsOf("1rem")).toEqual({ top: "1rem", right: "1rem", bottom: "1rem", left: "1rem" });
  });

  it("sets edges individually and leaves the rest to the safe area", () => {
    expect(insetsOf({ top: 0, bottom: "none", left: "safe-area", right: " 8px " })).toEqual({
      top: "0px",
      right: "8px",
      bottom: "0px",
      left: undefined,
    });
    expect(insetsOf({})).toEqual({
      top: undefined,
      right: undefined,
      bottom: undefined,
      left: undefined,
    });
  });

  it("treats an empty length as unset", () => {
    expect(insetsOf("  ").top).toBeUndefined();
  });
});
