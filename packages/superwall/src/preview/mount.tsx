import * as React from "react";
import { createRoot } from "react-dom/client";
import { surfaces } from "virtual:superwall/project";
import { SurfaceHost } from "./surface";
import { applyThemeOverride, readPreviewOverrides } from "./overrides";

declare global {
  interface Window {
    __swPreviewApply?: (search: string) => void;
  }
}

const match = window.location.pathname.match(/^\/preview\/(paywall|funnel)\/([a-z0-9-]+)\/?$/);
const surface = match
  ? surfaces.find((entry) => entry.kind === match[1] && entry.id === match[2])
  : undefined;

applyThemeOverride(readPreviewOverrides(window.location.search).theme);

const PreviewRoot = ({ surfaceEntry }: { surfaceEntry: NonNullable<typeof surface> }) => {
  const [state, setState] = React.useState(() => ({
    overrides: readPreviewOverrides(window.location.search),
    generation: 0,
  }));

  React.useEffect(() => {
    window.__swPreviewApply = (search: string) => {
      const query = search.startsWith("?") || search === "" ? search : `?${search}`;
      window.history.replaceState(null, "", `${window.location.pathname}${query}`);
      const overrides = readPreviewOverrides(query);
      applyThemeOverride(overrides.theme);
      setState((current) => ({ overrides, generation: current.generation + 1 }));
    };
    return () => {
      delete window.__swPreviewApply;
    };
  }, []);

  return <SurfaceHost key={state.generation} surface={surfaceEntry} overrides={state.overrides} />;
};

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {surface ? (
      <PreviewRoot surfaceEntry={surface} />
    ) : (
      <pre style={{ padding: 24, fontFamily: "ui-monospace, monospace" }}>
        {`No surface at ${window.location.pathname} — expected /preview/<paywall|funnel>/<id>`}
      </pre>
    )}
  </React.StrictMode>,
);
