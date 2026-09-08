// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { TransportKind } from "@superwall/protocol";
import {
  createRuntimeTransport,
  detectRuntimeTransportKind,
  detectSuperwallHost,
} from "../../src/bridge/transport";
import { createSuperwallSession } from "../../src/session";

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
    expect(typeof createRuntimeTransport().postMessage).toBe("function");
  });

  it("builds an explicitly requested transport", () => {
    expect(typeof createRuntimeTransport(TransportKind.WebKitPostMessage).postMessage).toBe(
      "function",
    );
  });

  it("is what a session sits on when none is passed in", () => {
    setSearch("?transport=editor");
    const session = createSuperwallSession();
    session.start();
    expect(session.getSnapshot().status).toBe("listening");
  });
});

describe("detectSuperwallHost (browser)", () => {
  it("is false in a plain browser window", () => {
    expect(detectSuperwallHost()).toBe(false);
  });

  it("detects the WKWebView message handler", () => {
    window.webkit = { messageHandlers: { paywallMessageHandler: { postMessage: () => {} } } };
    expect(detectSuperwallHost()).toBe(true);
  });

  it("ignores an incomplete webkit object", () => {
    window.webkit = { messageHandlers: {} };
    expect(detectSuperwallHost()).toBe(false);
  });

  it("detects the Android JS interface", () => {
    globalThis.SWAndroid = { postMessage: () => {} };
    expect(detectSuperwallHost()).toBe(true);
  });

  it("detects hosts that announce themselves in the query string", () => {
    setSearch("?platform=android");
    expect(detectSuperwallHost()).toBe(true);

    setSearch("?transport=editor");
    expect(detectSuperwallHost()).toBe(true);
  });
});
