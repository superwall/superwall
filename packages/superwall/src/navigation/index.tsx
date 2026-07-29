import * as React from "react";

export type PaywallRoute = {
  path: string;
  Component: React.ComponentType;
};

export type Router = {
  path: string;
  push: (path: string) => void;
  replace: (path: string) => void;
  back: () => void;
  canGoBack: boolean;
};

const RouterContext = React.createContext<Router | null>(null);

export const useRouter = (): Router => {
  const router = React.useContext(RouterContext);
  if (!router) {
    throw new Error("useRouter() must be used inside a paywall mounted by superwall");
  }
  return router;
};

const normalize = (path: string): string => {
  const trimmed = path.trim().replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

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
    for (const route of Object.keys(parsed)) {
      const value: unknown = Reflect.get(parsed, route);
      if (Array.isArray(value)) map[route] = value.filter(isRouteAsset);
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

export type PaywallRouterProps = {
  routes: readonly PaywallRoute[];
  initialPath?: string;
  Layout?: React.ComponentType<React.PropsWithChildren>;
  onNavigate?: (path: string) => void;
};

export const PaywallRouter = ({
  routes,
  initialPath = "/",
  Layout,
  onNavigate,
}: PaywallRouterProps) => {
  const [stack, setStack] = React.useState<string[]>([normalize(initialPath)]);
  const path = stack[stack.length - 1];
  const notify = React.useRef(onNavigate);
  notify.current = onNavigate;
  const known = React.useRef(routes);
  known.current = routes;
  const assets = React.useRef<Record<string, RouteAsset[]> | undefined>(undefined);
  const warmed = React.useRef<Set<string>>(new Set());
  const mounted = React.useRef(false);

  React.useEffect(() => {
    notify.current?.(path);

    const map = (assets.current ??= readRouteAssets());
    const list = known.current;
    const at = list.findIndex((candidate) => candidate.path === path);
    const next = at === -1 ? undefined : list[at + 1];

    const warm: RouteAsset[] = [];
    if (!mounted.current) {
      mounted.current = true;
      warm.push(...(map["*"] ?? []), ...(map[path] ?? []));
    }
    if (next) warm.push(...(map[next.path] ?? []));
    warmAssets(warm, warmed.current);
  }, [path]);

  const router = React.useMemo<Router>(
    () => ({
      path,
      canGoBack: stack.length > 1,
      push: (target) => setStack((current) => [...current, normalize(target)]),
      replace: (target) => setStack((current) => [...current.slice(0, -1), normalize(target)]),
      back: () => setStack((current) => (current.length > 1 ? current.slice(0, -1) : current)),
    }),
    [path, stack.length],
  );

  const route = routes.find((candidate) => candidate.path === path) ?? routes[0];
  if (!route) return null;

  const page = <route.Component />;
  return (
    <RouterContext.Provider value={router}>
      {Layout ? <Layout>{page}</Layout> : page}
    </RouterContext.Provider>
  );
};

export type LinkProps = React.PropsWithChildren<{
  href: string;
  replace?: boolean;
  className?: string;
}>;

export const Link = ({ href, replace = false, className, children }: LinkProps) => {
  const router = useRouter();
  return (
    <a
      href={href}
      className={className}
      onClick={(event) => {
        event.preventDefault();
        if (replace) router.replace(href);
        else router.push(href);
      }}
    >
      {children}
    </a>
  );
};
