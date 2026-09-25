import { describe, expect, it } from "vitest";
import { TransportKind } from "@superwall/protocol";
import { detectRuntimeTransportKind, detectSuperwallHost } from "../../src/bridge/transport";

describe("detectRuntimeTransportKind", () => {
  it("selects Android via the platform query param", () => {
    expect(detectRuntimeTransportKind({ search: "?platform=android" })).toBe(TransportKind.Android);
  });

  it("selects the editor iframe via the transport query param", () => {
    expect(detectRuntimeTransportKind({ search: "?transport=editor" })).toBe(
      TransportKind.EditorIframe,
    );
  });

  it("selects the Web SDK via the transport query param", () => {
    expect(detectRuntimeTransportKind({ search: "?platform=web&transport=web" })).toBe(
      TransportKind.WebSdk,
    );
  });

  it("defaults to WebKit", () => {
    expect(detectRuntimeTransportKind({ search: "" })).toBe(TransportKind.WebKitPostMessage);
    expect(detectRuntimeTransportKind({ search: "?foo=bar" })).toBe(
      TransportKind.WebKitPostMessage,
    );
  });

  it("defaults to WebKit when there is no window and no search override", () => {
    expect(detectRuntimeTransportKind()).toBe(TransportKind.WebKitPostMessage);
  });
});

describe("detectSuperwallHost", () => {
  it("is false outside a browser", () => {
    expect(detectSuperwallHost()).toBe(false);
  });
});
