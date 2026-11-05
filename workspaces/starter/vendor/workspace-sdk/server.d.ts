// Generated from packages/workspace-sdk by its vendor script. Do not edit.
import type { MetricRequest, MetricSeries, ReadoutRequest, ReadoutResult } from "./metrics";
import type { SlotContext, SlotId } from "./slots";
import type { WorkspaceTrigger } from "./platform";
/**
 * Server-side helpers for a workspace's Worker. Customer bundles get no
 * bindings: every capability is a `fetch` that the platform's outbound Worker
 * intercepts and authorizes, so these helpers only build requests.
 */
export interface WorkspaceRequest<S extends SlotId = SlotId> {
    readonly request: Request;
    /** The manifest entrypoint being served, or null outside a mount. */
    readonly entrypoint: string | null;
    readonly trigger: WorkspaceTrigger;
    /** The slot context the API bound into this session, already authorized. */
    readonly context: SlotContext<S> | null;
}
export declare const readRequest: <S extends SlotId = SlotId>(request: Request) => WorkspaceRequest<S>;
/**
 * Call the Superwall API as this workspace's principal: the viewer for a
 * mount, the run-as admin in the background. `path` is an API path such as
 * `/v2/projects`.
 */
export declare const superwallFetch: (path: string, init?: RequestInit) => Promise<Response>;
/**
 * One handler per kind of entrypoint, like a Worker's `fetch` / `queue` /
 * `scheduled`: `fetch` serves rendered slots (pages, panels), `metric` answers
 * `chart.source` entrypoints and `readout` answers `campaign.metric` ones. The
 * platform calls each directly.
 */
export interface WorkspaceHandlers {
    readonly fetch: (request: WorkspaceRequest) => Response | Promise<Response>;
    /** Required when the manifest declares a `chart.source` entrypoint. */
    readonly metric?: (request: MetricRequest) => MetricSeries | Promise<MetricSeries>;
    /** Required when the manifest declares a `campaign.metric` entrypoint. */
    readonly readout?: (request: ReadoutRequest) => ReadoutResult | Promise<ReadoutResult>;
}
/** Wrap the workspace's handlers as the Worker's default export. */
export declare const defineWorkspace: (handlers: WorkspaceHandlers) => {
    readout?: ((request: ReadoutRequest) => ReadoutResult | Promise<ReadoutResult>) | undefined;
    metric?: ((request: MetricRequest) => MetricSeries | Promise<MetricSeries>) | undefined;
    fetch: (request: Request) => Response | Promise<Response>;
};
