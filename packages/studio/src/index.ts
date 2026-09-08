import "./styles.css";

export { StudioApp } from "./StudioApp";
export { SurfaceEditor } from "./screens/SurfaceEditor";
export { SurfaceList } from "./screens/SurfaceList";
export { DeviceFrame } from "./components/DeviceFrame";
export { PaywallToasts, createStudioDelegate, useStudioDelegate } from "./components/PaywallToasts";
export { StudioShell } from "./components/StudioShell";
export { TopBar } from "./components/TopBar";
export { VariablesPanel } from "./components/VariablesPanel";
export { Segmented, Select, Switch } from "./components/controls";
export { DEFAULT_DEVICE_ID, deviceById, STUDIO_DEVICES } from "./lib/devices";
export type { StudioDevice } from "./lib/devices";
export { hostPatch, hostStateFor, studioDefaults } from "./lib/host";
export type { HostInputs } from "./lib/host";
export { buildPreviewPath, hostedUrl, snapshotPreviewUrl, surfacePath } from "./lib/preview";
export { parseProjectPayload, type StudioProjectPayload } from "./lib/project";
export type {
  PreviewUrlBuilder,
  SampleDefaults,
  Samples,
  StudioSource,
  StudioSurface,
  StudioSurfaceKind,
  VariableOverrides,
} from "./lib/types";
