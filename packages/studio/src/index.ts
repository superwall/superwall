import "./styles.css";

export { StudioApp } from "./StudioApp";
export { SurfaceEditor, type StudioPanel } from "./screens/SurfaceEditor";
export {
  editVariable,
  findDevice,
  parseStudioCommands,
  STUDIO_COMMAND_TYPES,
  type StudioCommand,
  type StudioCommandError,
  type StudioCommandResult,
  type StudioCommandType,
  type StudioHandle,
  type StudioState,
} from "./lib/commands";
export { SurfaceList } from "./screens/SurfaceList";
export { DeviceFrame } from "./components/preview/DeviceFrame";
export {
  Canvas,
  useCanvasScale,
  type CanvasHandle,
  type CanvasZoom,
} from "./components/preview/Canvas";
export { percent } from "./lib/canvas";
export { HostedIframe } from "./components/preview/HostedIframe";
export { PaywallToasts, createStudioDelegate, useStudioDelegate } from "./components/PaywallToasts";
export { StudioShell } from "./components/chrome/StudioShell";
export { DownloadScreenshot } from "./components/DownloadScreenshot";
export { PreviewOnDevice } from "./components/PreviewOnDevice";
export { Tooltip } from "./components/Tooltip";
export { TopBar } from "./components/chrome/TopBar";
export { VariablesPanel } from "./components/panels/VariablesPanel";
export { HostPanel } from "./components/panels/SidePanel";
export { Segmented, Select, Switch } from "./components/controls";
export {
  chromeFor,
  DEFAULT_DEVICE_ID,
  deviceById,
  deviceVariablesFor,
  isWebOnly,
  STUDIO_DEVICES,
  webViewportFor,
} from "./lib/devices";
export type { DeviceChromeSpec, SafeAreaInsets, StudioDevice } from "./lib/devices";
export { hostStateFor, studioDefaults } from "./lib/host";
export { hasActions } from "./lib/surfaces";
export { devServerActions } from "./lib/actions";
export {
  latestVersion,
  liveVersion,
  promotionDirection,
  type PromotionDirection,
} from "./lib/promotion";
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
  StudioActionRequest,
  StudioActionResult,
  StudioActions,
  StudioPresentation,
  StudioResume,
  StudioSource,
  StudioStatus,
  StudioSurface,
  StudioSurfaceKind,
  StudioVersion,
} from "./lib/surfaces";
export type { SampleDefaults, VariableOverrides } from "./lib/variables";
