import * as React from "react";
import { createRoot } from "react-dom/client";
import { surfaces } from "virtual:superwall/project";
import { usePreviewOverrides } from "./host";
import { SurfaceHost } from "./surface";

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

const PreviewRoot = ({ surfaceEntry }: { surfaceEntry: NonNullable<typeof surface> }) => {
  const overrides = usePreviewOverrides();

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
