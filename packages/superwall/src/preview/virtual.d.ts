declare module "virtual:superwall/project" {
  export type PreviewModule<T> = () => Promise<{ default: T }>;
  export type PreviewPage = {
    route: string;
    load: PreviewModule<React.ComponentType>;
  };
  export type PreviewMessages = {
    locale: string;
    load: PreviewModule<Record<string, unknown>>;
  };
  export type PreviewSurface = {
    kind: "paywall" | "funnel";
    id: string;
    pages: PreviewPage[];
    messages: PreviewMessages[];
    loadConfig: PreviewModule<unknown>;
    loadLayout?: PreviewModule<React.ComponentType<React.PropsWithChildren>>;
  };
  export const surfaces: PreviewSurface[];
  export const loadAppConfig: PreviewModule<unknown>;
  export const sharedMessages: PreviewMessages[];
  export const diagnostics: string[];
}
