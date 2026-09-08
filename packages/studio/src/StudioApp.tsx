import * as React from "react";
import { StudioShell } from "./components/StudioShell";
import { SurfaceEditor } from "./screens/SurfaceEditor";
import { SurfaceList } from "./screens/SurfaceList";
import { surfacePath } from "./lib/preview";
import { fetchSamples } from "./lib/actions";
import type { Samples, StudioSource, StudioSurface } from "./lib/types";

const surfaceFromPath = (
  surfaces: StudioSurface[],
  pathname: string,
): StudioSurface | undefined => {
  const match = pathname.match(/^\/(?:([a-z0-9-]+)\/)?(paywall|funnel)\/([a-z0-9-]+)\/?$/);
  if (!match) return undefined;
  return surfaces.find(
    (surface) =>
      surface.kind === match[2] &&
      surface.id === match[3] &&
      (match[1] === undefined || surface.project === match[1]),
  );
};

export const StudioApp = ({
  source,
  device = false,
}: {
  source: StudioSource;
  device?: boolean;
}) => {
  const [pathname, setPathname] = React.useState(() => window.location.pathname);
  const [samples, setSamples] = React.useState<Samples>({});

  React.useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  React.useEffect(() => {
    if (source.capabilities?.actions !== true) return;
    let cancelled = false;
    fetchSamples().then((value) => {
      if (!cancelled) setSamples(value);
    });
    return () => {
      cancelled = true;
    };
  }, [source.capabilities?.actions]);

  const navigate = (path: string) => {
    window.history.pushState(null, "", path);
    setPathname(path);
  };

  const active = surfaceFromPath(source.surfaces, pathname);

  return (
    <StudioShell>
      {active ? (
        <SurfaceEditor
          source={source}
          surface={active}
          samples={samples}
          onBack={() => navigate(device ? "/device" : "/")}
        />
      ) : (
        <SurfaceList
          source={source}
          device={device}
          onOpen={(surface) => navigate(surfacePath(surface))}
        />
      )}
    </StudioShell>
  );
};
