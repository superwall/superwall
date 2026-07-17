// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { TransportKind } from "@superwall/protocol";
import {
  createRuntimeTransport,
  detectNativeSuperwallHost,
  detectRuntimeTransportKind,
} from "../src/bridge/transport";

const setSearch = (search: string) => {
  window.history.replaceState({}, "", `/${search}`);
};

afterEach(() => {
  delete window.webkit;
  globalThis.SWAndroid = undefined;
  setSearch("");
});

describe("detectRuntimeTransportKind (browser)", () => {
  it("reads window.location.search when no override is given", () => {
    setSearch("?platform=android");
    expect(detectRuntimeTransportKind()).toBe(TransportKind.Android);

    setSearch("?transport=editor");
    expect(detectRuntimeTransportKind()).toBe(TransportKind.EditorIframe);

    setSearch("");
    expect(detectRuntimeTransportKind()).toBe(TransportKind.WebKitPostMessage);
  });
});

describe("createRuntimeTransport", () => {
  it("builds the detected transport by default", () => {
    setSearch("?platform=android");
    const transport = createRuntimeTransport();
    expect(typeof transport.postMessage).toBe("function");
  });

  it("builds an explicitly requested transport", () => {
    const transport = createRuntimeTransport(TransportKind.WebKitPostMessage);
    expect(typeof transport.postMessage).toBe("function");
  });
});

describe("detectNativeSuperwallHost (browser)", () => {
  it("is false in a plain browser window", () => {
    expect(detectNativeSuperwallHost()).toBe(false);
  });

  it("detects the WKWebView message handler", () => {
    window.webkit = { messageHandlers: { paywallMessageHandler: { postMessage: () => {} } } };
    expect(detectNativeSuperwallHost()).toBe(true);
  });

  it("ignores an incomplete webkit object", () => {
    window.webkit = { messageHandlers: {} };
    expect(detectNativeSuperwallHost()).toBe(false);
  });

  it("detects the Android JS interface", () => {
    globalThis.SWAndroid = { postMessage: () => {} };
    expect(detectNativeSuperwallHost()).toBe(true);
  });

  it("detects native hosts via the SDK query params", () => {
    setSearch("?platform=android");
    expect(detectNativeSuperwallHost()).toBe(true);

    setSearch("?transport=editor");
    expect(detectNativeSuperwallHost()).toBe(true);
  });
});
