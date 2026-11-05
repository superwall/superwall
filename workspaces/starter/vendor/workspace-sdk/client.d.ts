// Generated from packages/workspace-sdk by its vendor script. Do not edit.
import type { AppMessage, Theme } from "./bridge";
/**
 * Browser side of the host bridge. The host sends `connect` with a nonce, the
 * context and the theme; every later message in either direction must carry
 * that nonce and come from the host's origin.
 */
type AppMessageBody = AppMessage extends infer M ? M extends AppMessage ? Omit<M, "protocol" | "nonce"> : never : never;
export interface Bridge<Context = unknown> {
    readonly context: Context;
    readonly theme: Theme;
    send(message: AppMessageBody): void;
    onContext(listener: (context: Context) => void): () => void;
    onTheme(listener: (theme: Theme) => void): () => void;
    onVisibility(listener: (visible: boolean) => void): () => void;
}
export interface ConnectOptions {
    /** Origins the dashboard may be served from. Defaults to Superwall's dashboards. */
    readonly hostOrigins?: ReadonlyArray<string>;
    /** Report the document height to the host as it changes. Defaults to true. */
    readonly autoResize?: boolean;
}
/** Wait for the host's `connect`, then reply `ready`. */
export declare const connect: <Context = unknown>(options?: ConnectOptions) => Promise<Bridge<Context>>;
export {};
