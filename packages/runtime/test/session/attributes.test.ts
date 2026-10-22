import { describe, expect, it, vi } from "vitest";
import { createSuperwallSession } from "../../src/session";
import { TestTransport } from "../support/testTransport";

const createSession = () => {
  const transport = new TestTransport();
  const session = createSuperwallSession({ transport });
  session.start();
  return { session, transport };
};

describe("setUserAttributes", () => {
  it("keeps a write made before the host's first state, which the host's reply predates", () => {
    const { session, transport } = createSession();

    session.setUserAttributes({ onboarding_opened: true });
    transport.accept({
      event_name: "template_variables",
      variables: { user: { firstName: "Ada", onboarding_opened: "stale" } },
    });

    expect(session.getSnapshot().user).toEqual({ firstName: "Ada", onboarding_opened: "true" });
    expect(session.getSnapshot().state).toMatchObject({
      user: { firstName: "Ada", onboarding_opened: "true" },
    });
  });

  it("lets later host state win once the host has answered", () => {
    const { session, transport } = createSession();

    session.setUserAttributes({ plan: "pro" });
    transport.accept({ event_name: "template_variables", variables: { user: {} } });
    transport.accept({ event_name: "template_variables", variables: { user: { plan: "free" } } });

    expect(session.getSnapshot().user).toEqual({ plan: "free" });
  });

  it("does not hold writes made after the host answered", () => {
    const { session, transport } = createSession();
    transport.accept({ event_name: "template_variables", variables: { user: {} } });

    session.setUserAttributes({ plan: "pro" });
    transport.accept({ event_name: "template_variables", variables: { user: { plan: "free" } } });

    expect(session.getSnapshot().user).toEqual({ plan: "free" });
  });

  it("sends user_attribute_updated with every value as a string", () => {
    const { session, transport } = createSession();

    session.setUserAttributes({ email: "ada@example.com", visits: 3, trial: true });

    expect(transport.outgoing.at(-1)).toEqual({
      event_name: "user_attribute_updated",
      attributes: [
        { key: "email", value: "ada@example.com" },
        { key: "visits", value: "3" },
        { key: "trial", value: "true" },
      ],
    });
  });

  it("applies the attributes to this paywall's own user record at once", () => {
    const { session, transport } = createSession();
    transport.accept({
      event_name: "template_variables",
      variables: { user: { firstName: "Ada", plan: "free" }, device: { platform: "iOS" } },
    });
    const listener = vi.fn();
    session.subscribe(listener);

    session.setUserAttributes({ email: "ada@example.com", plan: "pro" });

    // Merged over what the host sent, as the host itself merges: nothing lost.
    expect(session.getSnapshot().user).toEqual({
      firstName: "Ada",
      plan: "pro",
      email: "ada@example.com",
    });
    // And visible through the state the SDK reads back, same as paywall.js.
    expect(session.getSnapshot().state).toMatchObject({
      user: { firstName: "Ada", plan: "pro", email: "ada@example.com" },
      device: { platform: "iOS" },
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("sends nothing and changes nothing for an empty set", () => {
    const { session, transport } = createSession();
    const before = session.getSnapshot();
    const sent = transport.outgoing.length;

    session.setUserAttributes({});

    expect(transport.outgoing).toHaveLength(sent);
    expect(session.getSnapshot()).toBe(before);
  });
});
