import { describe, expect, it } from "vitest";
import {
  editVariable,
  findDevice,
  parseStudioCommands,
  STUDIO_COMMAND_TYPES,
  variableOverrides,
} from "../../src/lib/commands";

describe("parseStudioCommands", () => {
  it("takes every command a person can give the editor", () => {
    const parsed = parseStudioCommands([
      { type: "zoom", to: "in" },
      { type: "zoom", to: 150 },
      { type: "device", device: "iPad" },
      { type: "size", width: 800 },
      { type: "size", height: 600 },
      { type: "orientation", orientation: "landscape" },
      { type: "theme", theme: "dark" },
      { type: "locale", locale: "de" },
      { type: "locale" },
      { type: "introductoryOffer", eligible: false },
      { type: "introductoryOffer" },
      { type: "variable", path: " user.name ", value: "Ada" },
      { type: "resetVariables" },
      { type: "variablesPanel", open: true },
      { type: "version", version: 12 },
      { type: "compare", with: "origin" },
      { type: "compare" },
      { type: "compare", with: ["draft:b", "v12"] },
      { type: "compareAdd", with: "draft:c" },
      { type: "compareRemove", with: "draft:b" },
      { type: "compareSwap", from: "draft:c", to: "origin" },
      { type: "select", with: "variant-b" },
      { type: "previewOnDevice", open: true },
      { type: "reload" },
    ]);
    expect(parsed).toEqual({
      ok: true,
      commands: [
        { type: "zoom", to: "in" },
        { type: "zoom", to: 150 },
        { type: "device", device: "iPad" },
        { type: "size", width: 800 },
        { type: "size", height: 600 },
        { type: "orientation", orientation: "landscape" },
        { type: "theme", theme: "dark" },
        { type: "locale", locale: "de" },
        { type: "locale", locale: null },
        { type: "introductoryOffer", eligible: false },
        { type: "introductoryOffer", eligible: null },
        { type: "variable", path: "user.name", value: "Ada" },
        { type: "resetVariables" },
        { type: "variablesPanel", open: true },
        { type: "version", version: 12 },
        { type: "compare", with: "origin" },
        { type: "compare", with: null },
        { type: "compare", with: ["draft:b", "v12"] },
        { type: "compareAdd", with: "draft:c" },
        { type: "compareRemove", with: "draft:b" },
        { type: "compareSwap", from: "draft:c", to: "origin" },
        { type: "select", with: "variant-b" },
        { type: "previewOnDevice", open: true },
        { type: "reload" },
      ],
    });
  });

  it.each([
    [[], "commands is a non-empty list"],
    ["zoom", "commands is a non-empty list"],
    [[null], "commands[0]: a command is an object with a type"],
    [[{ type: "zoom", to: -5 }], "commands[0]: zoom.to is in, out, fit, actual or a percentage"],
    [[{ type: "device", device: " " }], "commands[0]: device.device is a device id or name"],
    [[{ type: "size", width: "wide" }], "commands[0]: size.width and size.height are numbers"],
    [[{ type: "size", height: Number.NaN }], "commands[0]: size.width and size.height are numbers"],
    [[{ type: "size" }], "commands[0]: size needs a width or a height"],
    [
      [{ type: "orientation", orientation: "up" }],
      "commands[0]: orientation.orientation is portrait or landscape",
    ],
    [[{ type: "theme", theme: "sepia" }], "commands[0]: theme.theme is light or dark"],
    [[{ type: "locale", locale: 4 }], "commands[0]: locale.locale is a locale code or null"],
    [
      [{ type: "introductoryOffer", eligible: "yes" }],
      "commands[0]: introductoryOffer.eligible is true, false or null",
    ],
    [
      [{ type: "variable", path: "" }],
      "commands[0]: variable.path is user.<key>, device.<key>, params.<key> or products.<reference>.<key>",
    ],
    [[{ type: "variablesPanel" }], "commands[0]: variablesPanel.open is true or false"],
    [[{ type: "version", version: "12" }], "commands[0]: version.version is a version number"],
    [
      [{ type: "compare", with: 12 }],
      "commands[0]: compare.with is a compare option's key or label, a list of them, or null",
    ],
    [
      [{ type: "compare", with: ["a", 1] }],
      "commands[0]: compare.with is a compare option's key or label, a list of them, or null",
    ],
    [
      [{ type: "compareAdd", with: " " }],
      "commands[0]: compareAdd.with is a compare option's key or label",
    ],
    [
      [{ type: "compareRemove" }],
      "commands[0]: compareRemove.with is a compare option's key or label",
    ],
    [[{ type: "select", with: 3 }], "commands[0]: select.with is a draft's key or label"],
    [
      [{ type: "compareSwap", from: "a" }],
      "commands[0]: compareSwap.from and compareSwap.to are compare options' keys or labels",
    ],
    [[{ type: "previewOnDevice" }], "commands[0]: previewOnDevice.open is true or false"],
  ])("refuses %j", (value, error) => {
    expect(parseStudioCommands(value)).toEqual({ ok: false, error });
  });

  it("names the commands it knows when it meets one it does not", () => {
    const parsed = parseStudioCommands([{ type: "zoom", to: "fit" }, { type: "shake" }]);
    expect(parsed).toEqual({
      ok: false,
      error: `commands[1]: unknown command type "shake"; use one of ${STUDIO_COMMAND_TYPES.join(", ")}`,
    });
  });
});

describe("findDevice", () => {
  it("finds a device by id or by name, loosely", () => {
    expect(findDevice("iphone-17-pro")).toMatchObject({ id: "iphone-17-pro" });
    expect(findDevice("iPhone 17 Pro")).toMatchObject({ id: "iphone-17-pro" });
    expect(findDevice("iphone_17_pro")).toMatchObject({ id: "iphone-17-pro" });
    expect(findDevice("Responsive")).toBe("responsive");
    expect(findDevice("Nokia 3310")).toBeUndefined();
    expect(findDevice("iPad Pro")).toMatchObject({ name: "iPad Pro 11″" });
    expect(findDevice("iPhone")).toBeUndefined();
    expect(findDevice("--")).toBeUndefined();
  });
});

describe("editVariable", () => {
  it("sets and resets user, device and params values", () => {
    const set = editVariable({ user: { plan: "pro" } }, "user.name", "Ada");
    expect(set).toEqual({ overrides: { user: { plan: "pro", name: "Ada" } } });
    const reset = editVariable({ user: { plan: "pro" } }, "user.plan", null);
    expect(reset).toEqual({ overrides: { user: {} } });
    expect(editVariable({}, "device.appVersion", "2.0")).toEqual({
      overrides: { device: { appVersion: "2.0" } },
    });
  });

  it("sets and resets a product slot's values", () => {
    const set = editVariable({}, "products.annual.price", "$9.99");
    expect(set).toEqual({ overrides: { products: { annual: { price: "$9.99" } } } });
    if (!("overrides" in set)) throw new Error("expected overrides");
    expect(editVariable(set.overrides, "products.annual.price", undefined)).toEqual({
      overrides: { products: {} },
    });
  });

  it("refuses a path outside the panel's groups", () => {
    expect(editVariable({}, "products.annual", 1)).toEqual({
      error: "products.annual is not products.<reference>.<key>",
    });
    expect(editVariable({}, "experiment.id", 1)).toEqual({
      error:
        "experiment.id is not user.<key>, device.<key>, params.<key> or products.<reference>.<key>",
    });
    expect(editVariable({}, "user", 1)).toHaveProperty("error");
  });
});

describe("variableOverrides", () => {
  it("leaves out the introductory offer switch", () => {
    expect(variableOverrides({ user: { a: 1 }, introductoryOfferEligible: true })).toEqual({
      user: { a: 1 },
    });
  });
});
