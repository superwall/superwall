import * as React from "react";
import { StudioShell } from "./components/chrome/StudioShell";
import { SurfaceEditor } from "./screens/SurfaceEditor";
import { SurfaceList } from "./screens/SurfaceList";
import { surfacePath } from "./lib/preview";
import { fetchSamples } from "./lib/actions";
import { StudioHostProvider, type StudioMode } from "./lib/studio-host";
import type { Samples, StudioSource, StudioSurface } from "./lib/surfaces";

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
  mode = "local",
}: {
  source: StudioSource;
  mode?: StudioMode;
}) => {
  const [pathname, setPathname] = React.useState(() => window.location.pathname);
  const [samples, setSamples] = React.useState<Samples>({});

  React.useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const shipping = source.actions !== undefined;
  React.useEffect(() => {
    if (!shipping) return;
    let cancelled = false;
    fetchSamples().then((value) => {
      if (!cancelled) setSamples(value);
    });
    return () => {
      cancelled = true;
    };
  }, [shipping]);

  const homePath = mode === "device" ? "/device" : "/";

  const navigate = React.useCallback((path: string) => {
    window.history.pushState(null, "", path);
    setPathname(path);
  }, []);

  const home = React.useMemo(
    () => ({ href: homePath, navigate: () => navigate(homePath) }),
    [homePath, navigate],
  );

  const active = surfaceFromPath(source.surfaces, pathname);

  return (
    <StudioHostProvider mode={mode} home={home}>
      <StudioShell>
        {active ? (
          <SurfaceEditor source={source} surface={active} samples={samples} />
        ) : (
          <SurfaceList source={source} onOpen={(surface) => navigate(surfacePath(surface))} />
        )}
      </StudioShell>
    </StudioHostProvider>
  );
};
