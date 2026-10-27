import { describe, expect, it } from "vitest";
import { bindsEntitlement } from "../../../src/checkout/host/surface";

describe("bindsEntitlement", () => {
  it("is true for the behaviors that self-claim, and for an unknown one", () => {
    expect(bindsEntitlement(undefined)).toBe(true);
    expect(bindsEntitlement("GRANT_ACCESS")).toBe(true);
    expect(bindsEntitlement("REDIRECT")).toBe(true);
    expect(bindsEntitlement("REDEEM")).toBe(false);
    expect(bindsEntitlement("CUSTOM")).toBe(false);
  });
});
