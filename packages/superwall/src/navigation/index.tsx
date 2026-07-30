import * as React from "react";
import { useSuperwallSession } from "../provider/context";
import "./routes.css";

// biome-ignore lint/suspicious/noEmptyInterface: augmentation target
export interface SuperwallRoutes {}

export type RouteName = keyof SuperwallRoutes extends never
  ? string
  : Extract<keyof SuperwallRoutes, string>;

/** The transitions that ship with the framework. */
export type BuiltInTransition = "push" | "slide" | "fade" | "none";

/**
 * A built-in, or any name you define yourself in CSS. The router only stamps
 * the name onto `data-sw-transition` — what it does is entirely up to the
 * stylesheet, and how long it runs is read back off the running animations.
 */
export type Transition = BuiltInTransition | (string & {});

export type NavigateOptions = {
  transition?: Transition;
};

export type Router = {
  /** The route currently on top. */
  name: RouteName;
  /** How many routes are stacked underneath this one. */
  depth: number;
  push: (route: RouteName, options?: NavigateOptions) => void;
  replace: (route: RouteName, options?: NavigateOptions) => void;
  back: () => void;
  canGoBack: () => boolean;
  /** Goes back `count` routes, stopping at the first. */
  dismiss: (count?: number) => void;
  /** Returns to the first route. */
  dismissAll: () => void;
  /** Goes back to `route` if it is in the stack, otherwise replaces the current one. */
  dismissTo: (route: RouteName, options?: NavigateOptions) => void;
};

export type RouteModule = {
  default: React.ComponentType;
  transition?: Transition;
};

export type RouteMap = Record<string, RouteModule>;

export const INITIAL_ROUTE = "index";

const INITIAL_KEY = 0;

type Direction = "forward" | "back";

type Entry = {
  key: number;
  name: string;
  transition?: Transition;
};

type Nav = {
  entries: Entry[];
  exiting?: Entry;
  direction: Direction;
};

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

type RouteAsset = { url: string; as: "image" | "video" | "audio" | "font" };

const ROUTE_ASSETS_ID = "sw-route-assets";

const isRouteAsset = (value: unknown): value is RouteAsset =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "url") === "string" &&
  ["image", "video", "audio", "font"].includes(String(Reflect.get(value, "as")));

const readRouteAssets = (): Record<string, RouteAsset[]> => {
  if (typeof document === "undefined") return {};
  const source = document.getElementById(ROUTE_ASSETS_ID)?.textContent;
  if (!source) return {};
  try {
    const parsed: unknown = JSON.parse(source);
    if (typeof parsed !== "object" || parsed === null) return {};
    const map: Record<string, RouteAsset[]> = {};
    for (const name of Object.keys(parsed)) {
      const value: unknown = Reflect.get(parsed, name);
      if (Array.isArray(value)) map[name] = value.filter(isRouteAsset);
    }
    return map;
  } catch {
    return {};
  }
};

const warmAssets = (assets: readonly RouteAsset[], warmed: Set<string>): void => {
  if (typeof document === "undefined") return;
  for (const asset of assets) {
    if (warmed.has(asset.url)) continue;
    warmed.add(asset.url);
    if (asset.as === "image") {
      new Image().src = asset.url;
      continue;
    }
    const link = document.createElement("link");
    link.setAttribute("rel", "preload");
    link.setAttribute("as", asset.as);
    link.setAttribute("href", asset.url);
    if (asset.as === "font") link.setAttribute("crossorigin", "anonymous");
    document.head.appendChild(link);
  }
};

const whenIdle = (run: () => void): (() => void) => {
  if (typeof window === "undefined") return () => {};
  const idle = Reflect.get(window, "requestIdleCallback") as
    | ((callback: () => void) => number)
    | undefined;
  if (typeof idle === "function") {
    const handle = idle(run);
    const cancel = Reflect.get(window, "cancelIdleCallback") as
      | ((handle: number) => void)
      | undefined;
    return () => cancel?.(handle);
  }
  const timer = setTimeout(run, 200);
  return () => clearTimeout(timer);
};

/** Only used where animations cannot be observed; otherwise they time themselves. */
export const TRANSITION_MS = 500;

/** Backstop so a runaway custom animation can never strand the stack. */
const TRANSITION_CAP = 5000;

const observable = (): boolean =>
  typeof Element !== "undefined" && typeof Element.prototype.getAnimations === "function";

export type PaywallRouterProps = {
  routes: RouteMap;
  Layout?: React.ComponentType<React.PropsWithChildren>;
  navigationId?: string;
  transition?: Transition;
  onNavigate?: (route: string) => void;
};

export const PaywallRouter = ({
  routes,
  Layout,
  navigationId = "paywall",
  transition: fallback = "push",
  onNavigate,
}: PaywallRouterProps) => {
  const session = useSuperwallSession();
  const [nav, setNav] = React.useState<Nav>(() => ({
    entries: [{ key: INITIAL_KEY, name: INITIAL_ROUTE }],
    direction: "forward",
  }));
  const { entries, exiting, direction } = nav;

  const known = React.useRef(routes);
  known.current = routes;
  const notify = React.useRef(onNavigate);
  notify.current = onNavigate;
  const nextKey = React.useRef(1);

  const top = entries[entries.length - 1];

  const router = React.useMemo<Router>(() => {
    const resolve = (name: string): string => {
      if (name in known.current) return name;
      throw new Error(
        `Unknown route "${name}". Available routes: ${Object.keys(known.current).join(", ")}`,
      );
    };

    const go = (name: string, options: NavigateOptions | undefined, keep: number | undefined) => {
      const target = resolve(name);
      const key = nextKey.current++;
      setNav((current) => {
        const kept = keep === undefined ? current.entries : current.entries.slice(0, keep);
        return {
          entries: [...kept, { key, name: target, ...options }],
          exiting:
            kept.length === current.entries.length
              ? undefined
              : current.entries[current.entries.length - 1],
          direction: "forward",
        };
      });
    };

    const popBy = (count: number) =>
      setNav((current) => {
        const removed = Math.min(Math.max(Math.trunc(count), 1), current.entries.length - 1);
        if (removed < 1) return current;
        return {
          entries: current.entries.slice(0, current.entries.length - removed),
          exiting: current.entries[current.entries.length - 1],
          direction: "back",
        };
      });

    return {
      name: top.name as RouteName,
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

  const layers = React.useRef<HTMLDivElement>(null);
  const [settled, setSettled] = React.useState(true);
  const animated = React.useRef(INITIAL_KEY);

  React.useLayoutEffect(() => {
    if (animated.current === top.key) return;
    animated.current = top.key;
    setSettled(false);
  }, [top.key]);

  React.useLayoutEffect(() => {
    if (settled) return;
    let live = true;
    const done = () => {
      if (live) setSettled(true);
    };

    if (!observable()) {
      const timer = setTimeout(done, TRANSITION_MS);
      return () => {
        live = false;
        clearTimeout(timer);
      };
    }

    const running = [...(layers.current?.children ?? [])].flatMap((child) =>
      child.getAnimations(),
    );
    if (running.length === 0) {
      done();
      return;
    }
    Promise.allSettled(running.map((animation) => animation.finished)).then(done);
    const cap = setTimeout(done, TRANSITION_CAP);
    return () => {
      live = false;
      clearTimeout(cap);
    };
  }, [settled]);

  const transitionOf = (entry: Entry): Transition =>
    entry.transition ?? routes[entry.name]?.transition ?? fallback;

  const moving = direction === "back" && exiting ? transitionOf(exiting) : transitionOf(top);

  const render = (
    entry: Entry,
    state: "active" | "behind" | "below" | "exiting",
    layer: number,
  ) => {
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
        data-sw-settled={settled ? "" : undefined}
        inert={!focused}
      >
        <FocusContext.Provider value={focused}>
          <Component />
        </FocusContext.Provider>
      </div>
    );
  };

  const stack = (
    <div
      data-sw-routes=""
      style={{ "--sw-transition": `${TRANSITION_MS}ms` } as React.CSSProperties}
    >
      {entries.map((entry, index) =>
        render(
          entry,
          index === entries.length - 1
            ? "active"
            : index === entries.length - 2
              ? "behind"
              : "below",
          index + 1,
        ),
      )}
      {exiting && !settled
        ? render(exiting, "exiting", direction === "back" ? entries.length + 1 : entries.length - 1)
        : null}
    </div>
  );

  return (
    <RouterContext.Provider value={router}>
      {Layout ? <Layout>{stack}</Layout> : stack}
    </RouterContext.Provider>
  );
};
