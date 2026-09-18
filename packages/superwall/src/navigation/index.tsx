import * as React from "react";
import { checkoutModeOf, detectSuperwallHost } from "@superwall/runtime";
import { useSuperwallSession } from "../provider/context";
import {
  freeze,
  longestAnimationMs,
  stillness,
  thaw,
  TRANSITION_CAP,
  TRANSITION_MS,
} from "./animation";
import { readRouteAssets, warmAssets, whenIdle } from "./assets";
import { createQueryStore, QueryStoreContext, type QueryHistory, type QueryStore } from "./query";
import type { StyleWithVariables } from "../css";
import "./routes.css";

export { TRANSITION_MS } from "./animation";

export {
  createParser,
  parseAsArrayOf,
  parseAsBoolean,
  parseAsFloat,
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
  useQueryState,
  type Parser,
  type ParserWithDefault,
  type QueryHistory,
  type QueryStateOptions,
  type QueryUpdate,
  type SetQueryState,
} from "./query";

export interface SuperwallRoutes {}

export type RouteName = keyof SuperwallRoutes extends never
  ? string
  : Extract<keyof SuperwallRoutes, string>;

type BuiltInTransition = "push" | "slide" | "fade" | "shift" | "none";

/**
 * A built-in, or any name you define yourself in CSS. The router only stamps
 * the name onto `data-sw-transition`; what it does is up to the stylesheet, and
 * how long it runs is read back off the running animations.
 */
export type Transition = BuiltInTransition | (string & {});

export type NavigateOptions = {
  /** The transition for this navigation, overriding the route's and the paywall's. */
  transition?: Transition;
};

export type Router = {
  /** The route currently on top. */
  name: RouteName;
  /** How many routes are stacked underneath this one. */
  depth: number;
  /** Adds a route on top; the one below it stays mounted. */
  push: (route: RouteName, options?: NavigateOptions) => void;
  /** Swaps the top route, so going back skips the one it replaced. */
  replace: (route: RouteName, options?: NavigateOptions) => void;
  /** Goes back one route. A no-op at the first. */
  back: () => void;
  /** Whether anything is underneath the current route. */
  canGoBack: () => boolean;
  /** Goes back `count` routes, stopping at the first. */
  dismiss: (count?: number) => void;
  /** Returns to the first route. */
  dismissAll: () => void;
  /** Goes back to `route` if it is in the stack, otherwise replaces the current one. */
  dismissTo: (route: RouteName, options?: NavigateOptions) => void;
};

export type RouteModule = {
  /** The route component, the default export of a file in `app/`. */
  default: React.ComponentType;
  /** This route's own transition, overriding the paywall's. */
  transition?: Transition;
};

export type RouteMap = Record<string, RouteModule>;

export const INITIAL_ROUTE = "index";

type Direction = "forward" | "back";

type Entry = {
  key: number;
  name: RouteName;
  transition?: Transition;
};

type Nav = {
  entries: Entry[];
  exiting?: Entry;
  direction: Direction;
  sync: QueryHistory | "skip";
};

export const NAV_KEY = "sw_nav";

const isRoute = (routes: RouteMap, name: string): name is RouteName => Object.hasOwn(routes, name);

const parseStack = (value: string | null, routes: RouteMap): RouteName[] | undefined => {
  if (value === null || value === "") return [INITIAL_ROUTE];
  const names: RouteName[] = [];
  for (const name of value.split(",")) {
    if (!isRoute(routes, name)) return undefined;
    names.push(name);
  }
  return names;
};

const askedStack = (routes: RouteMap): RouteName[] | undefined =>
  parseStack(new URLSearchParams(window.location.search).get(NAV_KEY), routes);

const serializeStack = (entries: readonly Entry[]): string | null =>
  entries.length === 1 && entries[0].name === INITIAL_ROUTE
    ? null
    : entries.map((entry) => entry.name).join(",");

const sameStack = (entries: readonly Entry[], names: readonly string[]): boolean =>
  entries.length === names.length && entries.every((entry, index) => entry.name === names[index]);

const RouterContext = React.createContext<Router | null>(null);
const FocusContext = React.createContext<boolean>(true);

export const useRouter = (): Router => {
  const router = React.useContext(RouterContext);
  if (!router) {
    throw new Error("useRouter() must be used inside a paywall mounted by superwall");
  }
  return router;
};

export const useIsFocused = (): boolean => React.useContext(FocusContext);

export type PaywallRouterProps = {
  /** Every route in the surface, keyed by name. The build generates this. */
  routes: RouteMap;
  /** Wraps the whole stack, from the surface's `app/layout.tsx`. */
  Layout?: React.ComponentType<React.PropsWithChildren>;
  /** Names this stack in the `page_view` events the SDK receives. */
  navigationId?: string;
  /** The paywall's default transition. Defaults to `push`. */
  transition?: Transition;
  /** Keeps the stack and `useQueryState` in the URL. Defaults to on with web checkout. */
  queryState?: boolean;
  /** Called with each route the paywall lands on, after it is reported. */
  onNavigate?: (route: string) => void;
};

type LayerState = "active" | "behind" | "below" | "exiting";

export const PaywallRouter = ({
  routes,
  Layout,
  navigationId = "paywall",
  transition: fallback = "push",
  queryState,
  onNavigate,
}: PaywallRouterProps) => {
  const session = useSuperwallSession();
  const [store] = React.useState<QueryStore>(() =>
    createQueryStore(
      (queryState ?? checkoutModeOf(session.getSnapshot().config?.checkout) !== undefined) &&
        !detectSuperwallHost(),
    ),
  );

  const [nav, setNav] = React.useState<Nav>(() => ({
    entries: (askedStack(routes) ?? [INITIAL_ROUTE]).map((name, key) => ({
      key,
      name,
    })),
    direction: "forward",
    sync: "replace",
  }));

  const { entries, exiting, direction } = nav;

  const known = React.useRef(routes);
  known.current = routes;
  const notify = React.useRef(onNavigate);
  notify.current = onNavigate;
  const nextKey = React.useRef(entries.length);
  const layers = React.useRef<HTMLDivElement>(null);

  const top = entries[entries.length - 1];

  const router = React.useMemo<Router>(() => {
    const resolve = (name: string): RouteName => {
      if (isRoute(known.current, name)) return name;
      throw new Error(
        `Unknown route "${name}". Available routes: ${Object.keys(known.current).join(", ")}`,
      );
    };

    const go = (name: string, options: NavigateOptions | undefined, keep: number | undefined) => {
      const target = resolve(name);
      const key = nextKey.current++;
      freeze(layers.current);
      setNav((current) => {
        const kept = keep === undefined ? current.entries : current.entries.slice(0, keep);
        return {
          entries: [...kept, { key, name: target, ...options }],
          exiting:
            kept.length === current.entries.length
              ? undefined
              : current.entries[current.entries.length - 1],
          direction: "forward",
          sync: keep === undefined ? "push" : "replace",
        };
      });
    };

    const popBy = (count: number) => {
      freeze(layers.current);
      setNav((current) => {
        const removed = Math.min(Math.max(Math.trunc(count), 1), current.entries.length - 1);
        if (removed < 1) return current;
        return {
          entries: current.entries.slice(0, current.entries.length - removed),
          exiting: current.entries[current.entries.length - 1],
          direction: "back",
          sync: "replace",
        };
      });
    };

    return {
      name: top.name,
      depth: entries.length - 1,
      push: (name, options) => go(name, options, undefined),
      replace: (name, options) => go(name, options, entries.length - 1),
      back: () => popBy(1),
      canGoBack: () => entries.length > 1,
      dismiss: (count = 1) => popBy(count),
      dismissAll: () => popBy(Number.MAX_SAFE_INTEGER),
      dismissTo: (name, options) => {
        const target = resolve(name);
        const at = entries.findIndex((entry) => entry.name === target);
        if (at === entries.length - 1) return;
        if (at === -1) go(target, options, entries.length - 1);
        else popBy(entries.length - 1 - at);
      },
    };
  }, [entries, top]);

  React.useEffect(() => {
    if (nav.sync === "skip") return;
    store.set({ [NAV_KEY]: serializeStack(nav.entries) }, nav.sync);
  }, [nav, store]);

  const navParam = React.useSyncExternalStore(
    store.subscribe,
    () => store.get(NAV_KEY),
    () => store.get(NAV_KEY),
  );

  React.useEffect(() => {
    const names = parseStack(store.get(NAV_KEY), known.current) ?? [INITIAL_ROUTE];
    if (sameStack(entries, names)) return;
    let shared = 0;
    while (
      shared < names.length &&
      shared < entries.length &&
      names[shared] === entries[shared].name
    ) {
      shared++;
    }
    const added = names.slice(shared).map((name) => ({ key: nextKey.current++, name }));
    freeze(layers.current);
    setNav({
      entries: [...entries.slice(0, shared), ...added],
      exiting: shared < entries.length ? entries[entries.length - 1] : undefined,
      direction: names.length < entries.length ? "back" : "forward",
      sync: "skip",
    });
  }, [navParam, entries, store]);

  const name = router.name;
  const depth = router.depth;
  const previous = React.useRef<{ name: string; depth: number; at: number } | undefined>(undefined);

  const reported = React.useRef<number | undefined>(undefined);

  React.useEffect(() => {
    if (reported.current === top.key) return;
    reported.current = top.key;
    notify.current?.(name);

    const before = previous.current;
    const now = Date.now();
    session.pageView({
      type: before ? direction : "entry",
      name,
      navigationId,
      position: depth,
      previousName: before?.name,
      previousPosition: before?.depth,
      timeOnPreviousMs: before ? now - before.at : undefined,
    });
    previous.current = { name, depth, at: now };
  }, [top.key, name, depth, direction, navigationId, session]);

  const warmed = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    const map = readRouteAssets();
    warmAssets([...(map["*"] ?? []), ...(map[INITIAL_ROUTE] ?? [])], warmed.current);
    return whenIdle(() => {
      for (const list of Object.values(map)) warmAssets(list, warmed.current);
    });
  }, []);

  const transitionOf = (entry: Entry): Transition =>
    entry.transition ?? routes[entry.name]?.transition ?? fallback;

  const moving = direction === "back" && exiting ? transitionOf(exiting) : transitionOf(top);

  const [movement, setMovement] = React.useState(0);
  const [settled, setSettled] = React.useState(true);
  const animated = React.useRef(top.key);

  React.useLayoutEffect(() => {
    if (animated.current === top.key) return;
    animated.current = top.key;
    setMovement((count) => count + 1);
    setSettled(false);
  }, [top.key]);

  React.useLayoutEffect(() => {
    if (settled) return;
    const container = layers.current;
    const done = () => {
      thaw(container);
      setSettled(true);
    };

    if (moving === "none" || stillness()) {
      done();
      return;
    }

    const measured = longestAnimationMs(container);
    const timer = setTimeout(done, Math.min(measured || TRANSITION_MS, TRANSITION_CAP));
    return () => clearTimeout(timer);
  }, [movement, settled, moving]);

  const phaseOf = (state: LayerState): string | undefined => {
    if (settled) return undefined;
    if (state === "active") return direction === "back" ? "return" : "enter";
    if (state === "exiting") return direction === "back" ? "leave" : "recede";
    if (state === "behind") return direction === "forward" ? "recede" : undefined;
    return undefined;
  };

  const render = (entry: Entry, state: LayerState, layer: number) => {
    const module = routes[entry.name];
    if (!module) return null;
    const Component = module.default;
    const focused = state === "active";
    return (
      <div
        key={entry.key}
        style={{ zIndex: layer }}
        data-sw-route={entry.name}
        data-sw-state={state}
        data-sw-direction={direction}
        data-sw-transition={state === "below" ? "none" : moving}
        data-sw-phase={phaseOf(state)}
        data-sw-settled={settled ? "" : undefined}
        inert={!focused}
      >
        <FocusContext.Provider value={focused}>
          <Component />
        </FocusContext.Provider>
      </div>
    );
  };

  const stateOf = (index: number): LayerState =>
    index === entries.length - 1 ? "active" : index === entries.length - 2 ? "behind" : "below";

  const layerStyle: StyleWithVariables = { "--sw-transition": `${TRANSITION_MS}ms` };

  const stack = (
    <div ref={layers} data-sw-routes="" style={layerStyle}>
      {entries.map((entry, index) => render(entry, stateOf(index), index + 1))}
      {exiting && !settled
        ? render(exiting, "exiting", direction === "back" ? entries.length + 1 : entries.length - 1)
        : null}
    </div>
  );

  return (
    <QueryStoreContext.Provider value={store}>
      <RouterContext.Provider value={router}>
        <div data-sw-root="">
          <div data-sw-content="">{Layout ? <Layout>{stack}</Layout> : stack}</div>
        </div>
      </RouterContext.Provider>
    </QueryStoreContext.Provider>
  );
};
