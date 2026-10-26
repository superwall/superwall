import { describe, expect, it } from "vitest";
import { teleportCopyFor } from "../../../src/checkout/teleport/copy";

describe("teleportCopyFor", () => {
  it("speaks the device's language, falling back to English", () => {
    expect(teleportCopyFor("en_US").waiting.title).toBe("Finish in your browser");
    expect(teleportCopyFor("es_MX").waiting.cancel).toBe("Cancelar");
    expect(teleportCopyFor(undefined).success.action).toBe("Return to App");
    expect(teleportCopyFor("xx_YY").waiting.title).toBe("Finish in your browser");
  });

  it("maps old language codes and picks the Chinese script by region", () => {
    expect(teleportCopyFor("no").waiting).toEqual(teleportCopyFor("nb").waiting);
    expect(teleportCopyFor("iw").dir).toBe("rtl");
    expect(teleportCopyFor("zh_TW")).toBe(teleportCopyFor("zh-Hant"));
    expect(teleportCopyFor("zh_Hant_HK")).toBe(teleportCopyFor("zh-Hant"));
    expect(teleportCopyFor("zh_CN")).toBe(teleportCopyFor("zh-Hans"));
    expect(teleportCopyFor("zh_Hans_TW")).toBe(teleportCopyFor("zh-Hans"));
    expect(teleportCopyFor("en").dir).toBeUndefined();
  });
});
