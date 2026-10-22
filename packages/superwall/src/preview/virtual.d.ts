declare module "virtual:superwall/project" {
  export type PreviewModule<T> = () => Promise<{ default: T }>;
  export type PreviewRoute = {
    name: string;
    load: () => Promise<import("../navigation/index").RouteModule>;
  };
  export type PreviewMessages = {
    locale: string;
    load: PreviewModule<import("@superwall/runtime").SuperwallMessages>;
  };
  export type PreviewSurface = {
    kind: "paywall" | "funnel";
    id: string;
    project: string;
    routes: PreviewRoute[];
    messages: PreviewMessages[];
    sharedMessages: PreviewMessages[];
    loadConfig: PreviewModule<import("../config").PaywallDefinition | undefined>;
    loadLayout?: () => Promise<{
      default: React.ComponentType<React.PropsWithChildren>;
      entry?: import("../navigation/index").Entry;
    }>;
  };
  export const surfaces: PreviewSurface[];
  export const sharedMessages: PreviewMessages[];
  export const diagnostics: string[];
}
