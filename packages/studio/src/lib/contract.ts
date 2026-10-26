export type StudioActionName = "push" | "promote" | "publish";

/**
 * What a push of a surface the account does not have yet was made for, so a
 * host that moves to the saved surface can finish it there.
 */
export type StudioResume = "preview";

export type StudioActionRequest = {
  action: StudioActionName;
  version?: number;
  resume?: StudioResume;
};

export type StudioActionResult =
  | { ok: true; version: number; live: boolean }
  | { ok: false; error: string };

export type StudioActionProgress = (step: string, state: "start" | "done") => void;

export type StudioVersion = {
  version: number;
  url: string;
  live: boolean;
  pushedAt?: string;
};

export type StudioStatus = {
  paywallId?: string;
  identifier?: string;
  versions?: StudioVersion[];
  active?: boolean;
  updatedAt?: string;
  unreachable?: string;
};

export type Samples = {
  device?: Record<string, unknown>;
  user?: Record<string, unknown>;
  products?: Record<string, Record<string, unknown>>;
  live?: { device: boolean; user: boolean };
  unreachable?: string;
};

export type AppScheme = {
  scheme?: string;
  source?: "dashboard" | "app";
  blocksLocalNetworking?: string;
};
