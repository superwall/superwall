declare module "virtual:superwall/project" {
  export type PreviewModule<T> = () => Promise<{ default: T }>;
  export type PreviewRoute = {
    name: string;
    load: () => Promise<{ default: React.ComponentType; transition?: string }>;
  };
  export type PreviewMessages = {
    locale: string;
    load: PreviewModule<Record<string, unknown>>;
  };
  export type PreviewSurface = {
    kind: "paywall" | "funnel";
    id: string;
    routes: PreviewRoute[];
    messages: PreviewMessages[];
    loadConfig: PreviewModule<unknown>;
    loadLayout?: PreviewModule<React.ComponentType<React.PropsWithChildren>>;
  };
  export const surfaces: PreviewSurface[];
  export const sharedMessages: PreviewMessages[];
  export const diagnostics: string[];
}
