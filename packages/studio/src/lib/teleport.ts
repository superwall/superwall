import * as React from "react";
import type { TOutgoingMessage } from "@superwall/host";

const ROUTE_QUERY_KEY = "sw_nav";

export type PreviewPlace =
  | { where: "app"; teleported: boolean }
  | { where: "browser"; teleported: true; route?: string; webDepth?: number };

export type TeleportChange = "teleported" | "returned";

export const IN_APP: PreviewPlace = { where: "app", teleported: false };

const routeOf = (url: string): string | undefined => {
  try {
    return new URL(url).searchParams.get(ROUTE_QUERY_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};

export const teleportStep = (
  place: PreviewPlace,
  message: TOutgoingMessage,
): { place: PreviewPlace; change?: TeleportChange } => {
  if (message.event_name === "open_url_external" && message.teleport === true) {
    const route = routeOf(message.url);
    return {
      place: { where: "browser", teleported: true, ...(route === undefined ? {} : { route }) },
      change: "teleported",
    };
  }
  if (place.where !== "browser") return { place };
  if (message.event_name === "close") return { place: { where: "app", teleported: true } };
  if (message.event_name !== "page_view") return { place };
  if (message.type === "entry") return { place: { where: "app", teleported: true } };
  if (place.webDepth === undefined) {
    return { place: { ...place, route: message.page_name, webDepth: message.flow_position } };
  }
  if (message.flow_position < place.webDepth) {
    return { place: { where: "app", teleported: true }, change: "returned" };
  }
  return { place: { ...place, route: message.page_name } };
};

export type TeleportTracker = {
  getSnapshot: () => PreviewPlace;
  subscribe: (listener: () => void) => () => void;
  feed: (message: TOutgoingMessage) => TeleportChange | undefined;
  reset: () => void;
};

export const createTeleportTracker = (): TeleportTracker => {
  let place: PreviewPlace = IN_APP;
  const listeners = new Set<() => void>();
  const set = (next: PreviewPlace) => {
    if (next === place) return;
    place = next;
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => place,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    feed: (message) => {
      const step = teleportStep(place, message);
      set(step.place);
      return step.change;
    },
    reset: () => set(IN_APP),
  };
};

export const usePreviewPlace = (
  resetKey: string,
): { tracker: TeleportTracker; place: PreviewPlace } => {
  const tracker = React.useMemo(createTeleportTracker, []);
  React.useEffect(() => tracker.reset(), [tracker, resetKey]);
  const place = React.useSyncExternalStore(tracker.subscribe, tracker.getSnapshot);
  return { tracker, place };
};
