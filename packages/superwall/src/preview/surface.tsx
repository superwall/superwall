import * as React from "react";
import type { SuperwallConfig, SuperwallMessages } from "@superwall/runtime";
import type { PreviewMessages, PreviewSurface } from "virtual:superwall/project";
import type { PaywallDefinition } from "../config";
import { mergeMessages } from "../internal";
import { PaywallRouter, type RouteMap } from "../navigation/index";
import { SuperwallProvider } from "../provider/context";
import { previewMockOptions, useStudioAnnouncement } from "./host";
import type { PreviewOverrides } from "./overrides";

const loadCatalogs = async (
  shared: PreviewMessages[],
  local: PreviewMessages[],
): Promise<Record<string, SuperwallMessages>> => {
  const catalogs: Record<string, SuperwallMessages> = {};
  for (const source of [shared, local]) {
    for (const entry of source) {
      const catalog = (await entry.load()).default as SuperwallMessages;
      catalogs[entry.locale] = mergeMessages(catalogs[entry.locale], catalog);
    }
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
      transition: PaywallDefinition["transition"];
      queryState: PaywallDefinition["queryState"];
    };

const useSurface = (surface: PreviewSurface): Loaded => {
  const [loaded, setLoaded] = React.useState<Loaded>({ status: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [definition, layout, catalogs, loadedRoutes] = await Promise.all([
        surface.loadConfig().then((mod) => mod.default as PaywallDefinition | undefined),
        surface.loadLayout?.().then((mod) => mod.default),
        loadCatalogs(surface.sharedMessages, surface.messages),
        Promise.all(
          surface.routes.map(async (route) => {
            const module = await route.load();
            return [route.name, module] as const;
          }),
        ),
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
        routes: Object.fromEntries(loadedRoutes) as RouteMap,
        Layout: layout,
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

const Announce = ({ config }: { config: SuperwallConfig }): null => {
  useStudioAnnouncement(config);
  return null;
};

export const SurfaceHost = ({
  surface,
  overrides = {},
}: {
  surface: PreviewSurface;
  overrides?: PreviewOverrides;
}) => {
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
    <SuperwallProvider config={loaded.config} mock={previewMockOptions(overrides, loaded.config)}>
      <Announce config={loaded.config} />
      <PaywallRouter
        routes={loaded.routes}
        Layout={loaded.Layout}
        transition={loaded.transition}
        queryState={loaded.queryState}
        navigationId={surface.id}
      />
    </SuperwallProvider>
  );
};
