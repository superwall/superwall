import * as React from "react";
import { createRoot } from "react-dom/client";
import { surfaces } from "virtual:superwall/project";
import { SurfaceHost } from "./surface";
import { applyThemeOverride, readPreviewOverrides } from "./overrides";

const match = window.location.pathname.match(/^\/preview\/(paywall|funnel)\/([a-z0-9-]+)\/?$/);
const surface = match
  ? surfaces.find((entry) => entry.kind === match[1] && entry.id === match[2])
  : undefined;

const overrides = readPreviewOverrides(window.location.search);
applyThemeOverride(overrides.theme);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {surface ? (
      <SurfaceHost surface={surface} overrides={overrides} />
    ) : (
      <pre style={{ padding: 24, fontFamily: "ui-monospace, monospace" }}>
        {`No surface at ${window.location.pathname} — expected /preview/<paywall|funnel>/<id>`}
      </pre>
    )}
  </React.StrictMode>,
);
