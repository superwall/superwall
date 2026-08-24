import * as React from "react";
import { createRoot } from "react-dom/client";
import { surfaces } from "virtual:superwall/project";
import { SurfaceHost } from "./surface";
import { applyThemeOverride, mergePreviewSearch, readPreviewOverrides } from "./overrides";

declare global {
  interface Window {
    __swPreviewApply?: (search: string) => void;
  }
}

const match = window.location.pathname.match(
  /^\/preview\/(?:([a-z0-9-]+)\/)?(paywall|funnel)\/([a-z0-9-]+)\/?$/,
);
const surface = match
  ? surfaces.find(
      (entry) =>
        entry.kind === match[2] &&
        entry.id === match[3] &&
        (match[1] === undefined || entry.project === match[1]),
    )
  : undefined;

applyThemeOverride(readPreviewOverrides(window.location.search).theme);

const PreviewRoot = ({ surfaceEntry }: { surfaceEntry: NonNullable<typeof surface> }) => {
  const [overrides, setOverrides] = React.useState(() =>
    readPreviewOverrides(window.location.search),
  );

  React.useEffect(() => {
    window.__swPreviewApply = (search: string) => {
      const query = mergePreviewSearch(window.location.search, search);
      window.history.replaceState(null, "", `${window.location.pathname}${query}`);
      const next = readPreviewOverrides(query);
      applyThemeOverride(next.theme);
      setOverrides(next);
    };
    return () => {
      delete window.__swPreviewApply;
    };
  }, []);

  // Deliberately unkeyed: remounting here would rebuild the router and drop
  // whichever route you were looking at. The provider swaps the session when
  // the overrides actually change.
  return <SurfaceHost surface={surfaceEntry} overrides={overrides} />;
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
