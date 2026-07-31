// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTransport,
  EditorTransport,
  MessageDirection,
  TransportKind,
  unwrap,
  wrap,
  type TIncomingMessage,
  type TOutgoingMessage,
  type WrappedMessage,
} from "../src";

const incoming: TIncomingMessage = {
  event_name: "template_substitutions_prefix",
  prefix: "freeTrial",
};
const outgoing: TOutgoingMessage = { event_name: "close" };

const parseWrapped = (raw: string) => JSON.parse(raw) as WrappedMessage<TOutgoingMessage>;

describe("wrap/unwrap", () => {
  it("round-trips a single message and an array", () => {
    const single = wrap(incoming, MessageDirection.ToPaywall);
    expect(unwrap<TIncomingMessage>(single, MessageDirection.ToPaywall)).toEqual([incoming]);

    const many = wrap([incoming, incoming], MessageDirection.ToPaywall);
    expect(unwrap<TIncomingMessage>(many, MessageDirection.ToPaywall)).toEqual([
      incoming,
      incoming,
    ]);
  });

  it("stamps the direction and version envelope", () => {
    const envelope = parseWrapped(wrap(outgoing, MessageDirection.FromPaywall));
    expect(envelope).toEqual({
      version: 1,
      direction: MessageDirection.FromPaywall,
      payload: { events: [outgoing] },
    });
  });

  it("returns no events for a direction mismatch", () => {
    const message = wrap(incoming, MessageDirection.FromPaywall);
    expect(unwrap<TIncomingMessage>(message, MessageDirection.ToPaywall)).toEqual([]);
  });

  it("returns no events for malformed JSON", () => {
    expect(unwrap<TIncomingMessage>("not json", MessageDirection.ToPaywall)).toEqual([]);
  });

  it("supports a strict validator that rejects bad envelopes", () => {
    const validator = {
      parse: (value: object): WrappedMessage<TIncomingMessage> => {
        if (!("version" in value)) throw new Error("missing version");
        return value as WrappedMessage<TIncomingMessage>;
      },
    };
    const valid = wrap(incoming, MessageDirection.ToPaywall);
    expect(unwrap(valid, MessageDirection.ToPaywall, validator)).toEqual([incoming]);
    expect(unwrap("{}", MessageDirection.ToPaywall, validator)).toEqual([]);
  });
});

describe("buildTransport", () => {
  it("builds a transport for every kind", () => {
    for (const kind of Object.values(TransportKind)) {
      const transport = buildTransport(kind);
      expect(typeof transport.postMessage).toBe("function");
      expect(typeof transport.addListener).toBe("function");
      expect(typeof transport.startListening).toBe("function");
      expect(typeof transport.accept).toBe("function");
    }
  });
});

describe("WebKit transport", () => {
  afterEach(() => {
    delete window.webkit;
    delete window.app;
  });

  it("posts wrapped messages to the paywall message handler", () => {
    const postMessage = vi.fn();
    window.webkit = { messageHandlers: { paywallMessageHandler: { postMessage } } };

    buildTransport(TransportKind.WebKitPostMessage).postMessage(outgoing);

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(parseWrapped(postMessage.mock.calls[0][0] as string)).toMatchObject({
      direction: MessageDirection.FromPaywall,
      payload: { events: [outgoing] },
    });
  });

  it("does not throw when no handler is registered", () => {
    expect(() =>
      buildTransport(TransportKind.WebKitPostMessage).postMessage(outgoing),
    ).not.toThrow();
  });

  it("queues for the host when no handler is listening yet, so the opening ping survives", () => {
    buildTransport(TransportKind.WebKitPostMessage).postMessage(outgoing);

    expect(window.app?.messages).toHaveLength(1);
    // Queued in the same wire form the handler would have received, so a host
    // draining the queue parses it exactly as it parses a live message.
    expect(parseWrapped(window.app?.messages?.[0] as string)).toMatchObject({
      direction: MessageDirection.FromPaywall,
      payload: { events: [outgoing] },
    });
  });

  it("keeps queued messages behind ones the host already left there", () => {
    window.app = { messages: [{ earlier: true }] };

    buildTransport(TransportKind.WebKitPostMessage).postMessage(outgoing);

    expect(window.app.messages).toHaveLength(2);
    expect(window.app.messages?.[0]).toEqual({ earlier: true });
  });

  it("stops queueing once a handler is registered", () => {
    const postMessage = vi.fn();
    window.webkit = { messageHandlers: { paywallMessageHandler: { postMessage } } };

    buildTransport(TransportKind.WebKitPostMessage).postMessage(outgoing);

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(window.app?.messages ?? []).toHaveLength(0);
  });

  it("only dispatches accepted messages while listening", () => {
    const transport = buildTransport(TransportKind.WebKitPostMessage);
    const handler = vi.fn();
    transport.addListener(handler);

    transport.accept(incoming);
    expect(handler).not.toHaveBeenCalled();

    transport.startListening();
    transport.accept(incoming);
    expect(handler).toHaveBeenCalledWith(incoming);
  });
});

describe("Android transport", () => {
  afterEach(() => {
    globalThis.SWAndroid = undefined;
  });

  it("posts wrapped messages to the SWAndroid interface", () => {
    const postMessage = vi.fn();
    globalThis.SWAndroid = { postMessage };

    buildTransport(TransportKind.Android).postMessage(outgoing);

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(parseWrapped(postMessage.mock.calls[0][0] as string)).toMatchObject({
      direction: MessageDirection.FromPaywall,
      payload: { events: [outgoing] },
    });
  });

  it("does not throw when the interface is absent", () => {
    expect(() => buildTransport(TransportKind.Android).postMessage(outgoing)).not.toThrow();
  });

  it("only dispatches accepted messages while listening", () => {
    const transport = buildTransport(TransportKind.Android);
    const handler = vi.fn();
    transport.addListener(handler);

    transport.accept(incoming);
    expect(handler).not.toHaveBeenCalled();

    transport.startListening();
    transport.accept(incoming);
    expect(handler).toHaveBeenCalledWith(incoming);
  });
});

const buildEditorTransport = () => {
  const postMessage = vi.fn();
  const transport = new EditorTransport({
    targetWindow: { postMessage } as unknown as Window,
    targetOrigin: "*",
  });
  return { transport, postMessage };
};

const dispatchWrapped = (data: unknown) => {
  window.dispatchEvent(new MessageEvent("message", { data }));
};

describe("Editor transport", () => {
  it("posts wrapped messages to the target window", () => {
    const { transport, postMessage } = buildEditorTransport();

    transport.postMessage(outgoing);

    expect(postMessage).toHaveBeenCalledTimes(1);
    const [raw, origin] = postMessage.mock.calls[0];
    expect(origin).toBe("*");
    expect(parseWrapped(raw as string)).toMatchObject({
      direction: MessageDirection.FromPaywall,
      payload: { events: [outgoing] },
    });
  });

  it("receives wrapped window messages while listening, and stops cleanly", () => {
    const { transport } = buildEditorTransport();
    const handler = vi.fn();
    transport.addListener(handler);

    // not listening yet
    dispatchWrapped(wrap(incoming, MessageDirection.ToPaywall));
    expect(handler).not.toHaveBeenCalled();

    transport.startListening();
    transport.startListening(); // idempotent
    dispatchWrapped(wrap(incoming, MessageDirection.ToPaywall));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(incoming);

    // non-string and wrong-direction payloads are ignored
    dispatchWrapped({ not: "a string" });
    dispatchWrapped(wrap(incoming, MessageDirection.FromPaywall));
    expect(handler).toHaveBeenCalledTimes(1);

    transport.stopListening();
    transport.stopListening(); // idempotent
    dispatchWrapped(wrap(incoming, MessageDirection.ToPaywall));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
