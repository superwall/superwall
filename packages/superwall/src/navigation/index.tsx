import * as React from "react";

/**
 * superwall/navigation — client-side navigation between a paywall's pages.
 *
 * Every paywall is a mini React app: `app/page.tsx` is its root page and
 * nested folders (`app/offer/page.tsx`) are its routes, Next.js-style. The
 * framework mounts the pages; components navigate with `useRouter()` and
 * `<Link>`. There is no URL bar inside an SDK webview, so navigation is
 * in-memory with a history stack for `back()`.
 */

export type PaywallRoute = {
  /** "/" for `app/page.tsx`, "/offer" for `app/offer/page.tsx`, … */
  path: string;
  Component: React.ComponentType;
};

export type Router = {
  /** The active route path. */
  path: string;
  push: (path: string) => void;
  replace: (path: string) => void;
  back: () => void;
  /** True when there is a previous page to go back to. */
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

export type PaywallRouterProps = {
  routes: readonly PaywallRoute[];
  initialPath?: string;
  /** Optional `app/layout.tsx` wrapping every page. */
  Layout?: React.ComponentType<React.PropsWithChildren>;
  /** Notified on every navigation — the framework reports page views. */
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

  React.useEffect(() => {
    notify.current?.(path);
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
