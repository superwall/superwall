import { describe, expect, it } from "vitest";
import pingReply from "../../protocol/test/fixtures/host/ping-reply.json";
import {
  DEFAULT_PARAMS,
  DEFAULT_USER,
  EXAMPLE_PRODUCT_VARIABLES,
  defaultDevice,
  derivedDeviceProperties,
  withoutTrial,
} from "../src/defaults";
import { FIXTURE_NOW } from "./messages.test";

const fixtureVariables = () => {
  const first = pingReply.events[0];
  if (first?.event_name !== "template_variables" || !first.variables) {
    throw new Error("fixture order changed");
  }
  return first.variables;
};

describe("defaults", () => {
  it("the default device is the API's default sample plus derived clocks", () => {
    expect(defaultDevice(FIXTURE_NOW)).toEqual(fixtureVariables().device);
  });

  it("local clocks follow the device's timezone offset", () => {
    const derived = derivedDeviceProperties(FIXTURE_NOW, 3600);
    expect(derived.utcTime).toBe("12:00:00");
    expect(derived.localTime).toBe("13:00:00");
    expect(derived.localDateTime).toBe("2026-09-08T13:00:00");
  });

  it("the default user and params match the fixture", () => {
    expect(DEFAULT_USER).toEqual(fixtureVariables().user);
    expect(DEFAULT_PARAMS).toEqual(fixtureVariables().params);
  });

  it("the example product matches the editor's fallback", () => {
    expect(EXAMPLE_PRODUCT_VARIABLES).toEqual(fixtureVariables().products[0]?.primary);
  });

  it("withoutTrial strips every trial key, case-insensitively", () => {
    const stripped = withoutTrial(EXAMPLE_PRODUCT_VARIABLES);
    expect(Object.keys(stripped).some((key) => key.toLowerCase().includes("trial"))).toBe(false);
    expect(stripped.price).toBe("$89.99");
    expect("rawTrialPeriodPrice" in stripped).toBe(false);
  });

  it("defaultDevice uses the current time when none is given", () => {
    const device = defaultDevice();
    expect(typeof device.utcDateTime).toBe("string");
    expect(device.platform).toBe("iOS");
  });
});
