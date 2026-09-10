import { describe, expect, it } from "vitest";
import pingReply from "../../protocol/test/fixtures/host/ping-reply.json";
import {
  DEFAULT_PARAMS,
  DEFAULT_USER,
  defaultDevice,
  derivedDeviceProperties,
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

  it("defaultDevice uses the current time when none is given", () => {
    const device = defaultDevice();
    expect(typeof device.utcDateTime).toBe("string");
    expect(device.platform).toBe("iOS");
  });
});
