import "./styles.css";

export { StudioApp } from "./StudioApp";
export { SurfaceEditor } from "./screens/SurfaceEditor";
export { SurfaceList } from "./screens/SurfaceList";
export { DeviceFrame } from "./components/DeviceFrame";
export { TopBar } from "./components/TopBar";
export { VariablesPanel } from "./components/VariablesPanel";
export { Segmented, Select, Switch } from "./components/controls";
export { DEFAULT_DEVICE_ID, deviceById, STUDIO_DEVICES } from "./lib/devices";
export type { StudioDevice } from "./lib/devices";
export { buildPreviewPath } from "./lib/preview";
export { parseProjectPayload, type StudioProjectPayload } from "./lib/project";
export type {
  PreviewOverrides,
  PreviewUrlBuilder,
  StudioSource,
  StudioSurface,
  StudioSurfaceKind,
} from "./lib/types";
