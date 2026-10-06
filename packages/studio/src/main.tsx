import * as React from "react";
import { createRoot } from "react-dom/client";
import { StudioShell } from "./components/chrome/StudioShell";
import { EmptyState } from "./components/EmptyState";
import { AlertTriangleIcon } from "./components/icons";
import { InlineCode } from "./components/InlineCode";
import { devServerActions } from "./lib/actions";
import { buildPreviewPath, surfacePath } from "./lib/preview";
import { parseProjectPayload } from "./lib/project";
import { StudioApp } from "./StudioApp";
import "./styles.css";
import type { StudioMode } from "./lib/studio-host";
import type { StudioSource } from "./lib/surfaces";

const loadSource = async (): Promise<StudioSource> => {
  const response = await fetch("/__studio/project.json");
  if (!response.ok) {
    throw new Error(`project data unavailable (${response.status})`);
  }
  const { capabilities, ...payload } = parseProjectPayload(await response.json());
  return {
    ...payload,
    ...(capabilities.actions ? { actions: devServerActions } : {}),
    previewUrl: buildPreviewPath,
    standaloneUrl: (surface) => `/preview${surfacePath(surface)}`,
  };
};

const Failure = ({ error }: { error: unknown }) => (
  <StudioShell>
    <div className="m-auto">
      <EmptyState
        size="lg"
        tone="destructive"
        icon={<AlertTriangleIcon />}
        title="Couldn’t load the studio"
        description={
          <>
            {String(error)}. Is <InlineCode>superwall dev</InlineCode> running in a project
            directory?
          </>
        }
      />
    </div>
  </StudioShell>
);

const root = createRoot(document.getElementById("root")!);

const mode: StudioMode = /^\/device\/?$/.test(window.location.pathname) ? "device" : "local";

loadSource()
  .then((source) => {
    root.render(
      <React.StrictMode>
        <StudioApp source={source} mode={mode} />
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
