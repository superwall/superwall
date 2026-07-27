import * as React from "react";
import { SurfaceEditor } from "./screens/SurfaceEditor";
import { SurfaceList } from "./screens/SurfaceList";
import type { StudioSource, StudioSurface } from "./lib/types";

const surfaceFromPath = (
  surfaces: StudioSurface[],
  pathname: string,
): StudioSurface | undefined => {
  const match = pathname.match(/^\/(paywall|funnel)\/([a-z0-9-]+)\/?$/);
  if (!match) return undefined;
  return surfaces.find((surface) => surface.kind === match[1] && surface.id === match[2]);
};

export const StudioApp = ({ source }: { source: StudioSource }) => {
  const [pathname, setPathname] = React.useState(() => window.location.pathname);

  React.useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = (path: string) => {
    window.history.pushState(null, "", path);
    setPathname(path);
  };

  const active = surfaceFromPath(source.surfaces, pathname);

  return (
    <div className="bg-ink text-cream fixed inset-0 flex flex-col font-sans text-[0.9375rem] tracking-[-0.01em] antialiased">
      {active ? (
        <SurfaceEditor source={source} surface={active} onBack={() => navigate("/")} />
      ) : (
        <SurfaceList
          source={source}
          onOpen={(surface) => navigate(`/${surface.kind}/${surface.id}`)}
        />
      )}
    </div>
  );
};
