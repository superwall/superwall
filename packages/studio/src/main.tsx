import * as React from "react";
import { createRoot } from "react-dom/client";
import { buildPreviewPath } from "./lib/preview";
import { parseProjectPayload } from "./lib/project";
import { StudioApp } from "./StudioApp";
import "./styles.css";
import type { StudioSource } from "./lib/types";

const loadSource = async (): Promise<StudioSource> => {
  const response = await fetch("/__studio/project.json");
  if (!response.ok) {
    throw new Error(`project data unavailable (${response.status})`);
  }
  const payload = parseProjectPayload(await response.json());
  return { ...payload, previewUrl: buildPreviewPath };
};

const Failure = ({ error }: { error: unknown }) => (
  <div className="bg-ink text-cream fixed inset-0 flex font-sans antialiased">
    <div className="m-auto flex flex-col items-center gap-3 text-center text-sm text-cream/55">
      <span className="sw-chip font-mono text-[0.6875rem]">studio</span>
      <p className="m-0">{String(error)}</p>
      <p className="m-0 text-cream/55">
        Is <code className="font-mono text-[0.8125rem] text-cream">superwall dev</code> running in a
        project directory?
      </p>
    </div>
  </div>
);

const root = createRoot(document.getElementById("root")!);

const device = /^\/device\/?$/.test(window.location.pathname);

loadSource()
  .then((source) => {
    root.render(
      <React.StrictMode>
        <StudioApp source={source} device={device} />
      </React.StrictMode>,
    );
  })
  .catch((error: unknown) => {
    root.render(
      <React.StrictMode>
        <Failure error={error} />
      </React.StrictMode>,
    );
  });
