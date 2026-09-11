import "./styles.css";

export { StudioApp } from "./StudioApp";
export { SurfaceEditor } from "./screens/SurfaceEditor";
export { SurfaceList } from "./screens/SurfaceList";
export { DeviceFrame } from "./components/preview/DeviceFrame";
export { HostedIframe } from "./components/preview/HostedIframe";
export { PaywallToasts, createStudioDelegate, useStudioDelegate } from "./components/PaywallToasts";
export { StudioShell } from "./components/chrome/StudioShell";
export { PreviewOnDevice } from "./components/PreviewOnDevice";
export { TopBar } from "./components/chrome/TopBar";
export { VariablesPanel } from "./components/panels/VariablesPanel";
export { Segmented, Select, Switch } from "./components/controls";
export { DEFAULT_DEVICE_ID, deviceById, STUDIO_DEVICES } from "./lib/devices";
export type { StudioDevice } from "./lib/devices";
export { hostStateFor, studioDefaults } from "./lib/host";
export { hasActions } from "./lib/surfaces";
export { devServerLink } from "./lib/scheme";
export {
  StudioHostProvider,
  useStudioHome,
  useStudioMode,
  type StudioHome,
  type StudioMode,
} from "./lib/studio-host";
export {
  createHostState,
  diffHostState,
  hasIntroductoryOffer,
  silentDelegate,
  type HostDelegate,
  type HostProduct,
  type HostState,
} from "@superwall/host";
export type { HostInputs } from "./lib/host";
export { buildPreviewPath, hostedUrl, snapshotPreviewUrl, surfacePath } from "./lib/preview";
export { parseProjectPayload, type StudioProjectPayload } from "./lib/project";
export type {
  AppScheme,
  PreviewUrlBuilder,
  Samples,
  StudioActionName,
  StudioActionProgress,
  StudioActionResult,
  StudioSource,
  StudioStatus,
  StudioSurface,
  StudioSurfaceKind,
} from "./lib/surfaces";
export type { SampleDefaults, VariableOverrides } from "./lib/variables";
