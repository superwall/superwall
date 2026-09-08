import { describe, expect, it } from "vitest";
import { z } from "zod";
import { IncomingMessageSchema, MessageDirection, unwrap, wrap } from "../src";
import pingReply from "./fixtures/host/ping-reply.json";
import sdkLifecycle from "./fixtures/host/sdk-lifecycle.json";

const replyEvents = pingReply.events.map((event) => IncomingMessageSchema.parse(event));
const sequences = Object.entries(sdkLifecycle.sequences);

describe("host fixtures", () => {
  it("the ping reply is five messages in the web host's order", () => {
    expect(replyEvents.map((event) => event.event_name)).toEqual([
      "template_variables",
      "experiment",
      "products",
      "template_substitutions_prefix",
      "paywall_open",
    ]);
  });

  it("template_variables carries products as an array of single-key objects", () => {
    const variables = replyEvents[0];
    if (variables?.event_name !== "template_variables") throw new Error("fixture order changed");
    const products = z.array(z.record(z.unknown())).parse(variables.variables.products);
    expect(products.length).toBeGreaterThan(0);
    for (const entry of products) {
      expect(Object.keys(entry)).toHaveLength(1);
    }
  });

  it.each(sequences)("the SDK sequence %s parses message by message", (_name, events) => {
    for (const event of events) {
      const parsed = IncomingMessageSchema.safeParse(event);
      expect(parsed.success, event.event_name).toBe(true);
    }
  });

  it("the ping reply survives the editor envelope round trip", () => {
    const wire = wrap(replyEvents, MessageDirection.ToPaywall);
    expect(typeof wire).toBe("string");
    expect(unwrap(wire, MessageDirection.ToPaywall)).toEqual(pingReply.events);
  });

  it("an envelope in the wrong direction unwraps to nothing", () => {
    const wire = wrap(replyEvents, MessageDirection.FromPaywall);
    expect(unwrap(wire, MessageDirection.ToPaywall)).toEqual([]);
  });
});
