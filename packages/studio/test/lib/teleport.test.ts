import { describe, expect, it, vi } from "vitest";
import type { TOutgoingMessage } from "@superwall/host";
import { createTeleportTracker, IN_APP, teleportStep } from "../../src/lib/teleport";

const teleport = (url = "http://localhost:5173/?sw_nav=plan&sw_ref=card"): TOutgoingMessage => ({
  event_name: "open_url_external",
  url,
  teleport: true,
});

const view = (
  page_name: string,
  flow_position: number,
  type: "entry" | "forward" | "back" = "forward",
): TOutgoingMessage => ({
  event_name: "page_view",
  type,
  page_name,
  page_node_id: page_name,
  navigation_node_id: "nav",
  flow_position,
});

const run = (messages: TOutgoingMessage[]) => {
  const tracker = createTeleportTracker();
  const changes = messages.map((message) => tracker.feed(message));
  return { place: tracker.getSnapshot(), changes };
};

describe("teleportStep", () => {
  it("moves to the browser on a teleport, naming the route it opens", () => {
    expect(teleportStep(IN_APP, teleport())).toEqual({
      place: { where: "browser", teleported: true, route: "plan" },
      change: "teleported",
    });
  });

  it("leaves the route out when the teleport URL does not name one", () => {
    expect(teleportStep(IN_APP, teleport("not a url")).place).toEqual({
      where: "browser",
      teleported: true,
    });
    expect(teleportStep(IN_APP, teleport("https://x.test/")).place).toEqual({
      where: "browser",
      teleported: true,
    });
  });

  it("ignores an external link that is not a teleport", () => {
    const step = teleportStep(IN_APP, { event_name: "open_url_external", url: "https://x.test" });
    expect(step).toEqual({ place: IN_APP });
  });

  it("ignores page views and closes while in the app", () => {
    expect(teleportStep(IN_APP, view("index", 0, "back")).place).toBe(IN_APP);
    expect(teleportStep(IN_APP, { event_name: "close" }).place).toBe(IN_APP);
  });
});

describe("createTeleportTracker", () => {
  it("starts in the app, never teleported", () => {
    expect(createTeleportTracker().getSnapshot()).toEqual({ where: "app", teleported: false });
  });

  it("stays in the browser for routes pushed there, and follows the route shown", () => {
    const { place, changes } = run([
      view("index", 0, "entry"),
      teleport(),
      view("plan", 1),
      view("checkout", 2),
      view("plan", 1, "back"),
    ]);
    expect(place).toEqual({ where: "browser", teleported: true, route: "plan", webDepth: 1 });
    expect(changes).toEqual([undefined, "teleported", undefined, undefined, undefined]);
  });

  it("returns to the app when going back below the first web route", () => {
    const { place, changes } = run([teleport(), view("plan", 1), view("index", 0, "back")]);
    expect(place).toEqual({ where: "app", teleported: true });
    expect(changes.at(-1)).toBe("returned");
  });

  it("returns to the app by depth even when the browser shows the same route again", () => {
    const { place } = run([teleport(), view("plan", 2), view("plan", 1, "back")]);
    expect(place.where).toBe("app");
  });

  it("returns quietly when the paywall closes or reloads in the browser", () => {
    expect(run([teleport(), view("plan", 1), { event_name: "close" }])).toEqual({
      place: { where: "app", teleported: true },
      changes: ["teleported", undefined, undefined],
    });
    expect(run([teleport(), view("plan", 1), view("index", 0, "entry")]).place).toEqual({
      where: "app",
      teleported: true,
    });
  });

  it("ignores other messages in the browser", () => {
    const { place } = run([teleport(), view("plan", 1), { event_name: "restore" }]);
    expect(place.where).toBe("browser");
  });

  it("tells subscribers about each change, not about messages that change nothing", () => {
    const tracker = createTeleportTracker();
    const listener = vi.fn();
    const unsubscribe = tracker.subscribe(listener);
    tracker.feed({ event_name: "restore" });
    expect(listener).not.toHaveBeenCalled();
    tracker.feed(teleport());
    expect(listener).toHaveBeenCalledTimes(1);
    tracker.reset();
    expect(tracker.getSnapshot()).toBe(IN_APP);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    tracker.feed(teleport());
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
