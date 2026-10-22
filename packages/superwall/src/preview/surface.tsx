import * as React from "react";
import type { SuperwallConfig, SuperwallMessages } from "@superwall/runtime";
import type { PreviewMessages, PreviewSurface } from "virtual:superwall/project";
import type { PaywallDefinition } from "../config";
import { mergeMessages } from "../internal";
import { PaywallRouter, type Entry, type RouteMap } from "../navigation/index";
import { SuperwallProvider } from "../provider/context";

const loadCatalogs = async (
  shared: PreviewMessages[],
  local: PreviewMessages[],
): Promise<Record<string, SuperwallMessages>> => {
  const catalogs: Record<string, SuperwallMessages> = {};
  for (const entry of [...shared, ...local]) {
    const { default: catalog } = await entry.load();
    catalogs[entry.locale] = mergeMessages(catalogs[entry.locale], catalog);
  }
  return catalogs;
};

type Loaded =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | {
      status: "ready";
      config: SuperwallConfig;
      routes: RouteMap;
      Layout?: React.ComponentType<React.PropsWithChildren>;
      entry?: Entry;
      transition: PaywallDefinition["transition"];
      queryState: PaywallDefinition["queryState"];
    };

const useSurface = (surface: PreviewSurface): Loaded => {
  const [loaded, setLoaded] = React.useState<Loaded>({ status: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [definition, layout, catalogs, loadedRoutes] = await Promise.all([
        surface.loadConfig().then((mod) => mod.default),
        surface.loadLayout?.(),
        loadCatalogs(surface.sharedMessages, surface.messages),
        Promise.all(surface.routes.map(async (route) => [route.name, await route.load()] as const)),
      ]);
      if (cancelled) return;

      const merged: SuperwallConfig = definition ?? {};
      const messages: Record<string, SuperwallMessages> = { ...catalogs };
      for (const [locale, catalog] of Object.entries(merged.localization?.messages ?? {})) {
        messages[locale] = mergeMessages(messages[locale], catalog);
      }

      setLoaded({
        status: "ready",
        config: {
          ...merged,
          localization: {
            defaultLocale: merged.localization?.defaultLocale ?? "en",
            messages,
          },
        },
        transition: definition?.transition,
        queryState: definition?.queryState,
        routes: Object.fromEntries(loadedRoutes),
        Layout: layout?.default,
        entry: layout?.entry,
      });
    };

    load().catch((error: unknown) => {
      if (!cancelled) setLoaded({ status: "error", error });
    });

    return () => {
      cancelled = true;
    };
  }, [surface]);

  return loaded;
};

export const SurfaceHost = ({ surface }: { surface: PreviewSurface }) => {
  const loaded = useSurface(surface);

  if (loaded.status === "loading") return null;
  if (loaded.status === "error") {
    return (
      <pre style={{ padding: 24, color: "#b91c1c", whiteSpace: "pre-wrap" }}>
        {`Failed to load ${surface.kind} "${surface.id}"\n\n${String(loaded.error)}`}
      </pre>
    );
  }

  return (
    <SuperwallProvider config={loaded.config}>
      <PaywallRouter
        routes={loaded.routes}
        Layout={loaded.Layout}
        entry={loaded.entry}
        transition={loaded.transition}
        queryState={loaded.queryState}
        navigationId={surface.id}
      />
    </SuperwallProvider>
  );
};
