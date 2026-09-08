import * as React from "react";
import { createRoot } from "react-dom/client";
import { surfaces } from "virtual:superwall/project";
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

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {surface ? (
      <SurfaceHost surface={surface} />
    ) : (
      <pre style={{ padding: 24, fontFamily: "ui-monospace, monospace" }}>
        {`No surface at ${window.location.pathname} — expected /preview/<paywall|funnel>/<id>`}
      </pre>
    )}
  </React.StrictMode>,
);
