// Generated from packages/workspace-sdk by its vendor script. Do not edit.
/**
 * How a workspace's browser code becomes the module its Worker imports. This
 * one file runs in the builder's image and in `superwall workspaces dev`, so the
 * two can't drift. It has no imports: the caller passes its own esbuild.
 *
 * Nothing here runs the customer's code. esbuild parses and concatenates source,
 * and with no plugin (`plugins` isn't an option a caller can reach) it has nowhere
 * to run any. Its options come from here and never from the repo.
 */
/** The browser bundle, as a Worker sees it. */
export interface ClientBundle {
    readonly scriptPath: string;
    readonly script: string;
    readonly stylePath: string | null;
    readonly style: string | null;
}
export interface ClientBuildError {
    /** Relative to the repo, or null for an error with no location. */
    readonly file: string | null;
    readonly line: number | null;
    readonly column: number | null;
    readonly text: string;
    /** The source line it points at. */
    readonly lineText: string | null;
}
/**
 * What browser code takes from the repo's tsconfig: `baseUrl` and `paths`, so
 * `import { Button } from "@/components/button"` resolves as it does in the
 * Worker. Nothing else is read, and esbuild never sees the file itself.
 */
export interface ClientTsconfig {
    readonly baseUrl?: string;
    readonly paths?: Readonly<Record<string, ReadonlyArray<string>>>;
}
export type ClientTsconfigResult = {
    readonly ok: true;
    readonly tsconfig: ClientTsconfig;
} | {
    readonly ok: false;
    readonly message: string;
};
export interface ClientBuildInput {
    readonly path: string;
    readonly bytes: number;
}
export type ClientBuildResult = {
    readonly ok: true;
    /** Source for the module to substitute for `CLIENT_BUNDLE_MODULE`. */
    readonly module: string;
    readonly scriptBytes: number;
    readonly styleBytes: number;
    /** What's in the bundle, largest first, for a developer whose bundle is too big. */
    readonly inputs: ReadonlyArray<ClientBuildInput>;
    /** Every file esbuild read. Refuse the bundle if `outsideRepoInputs` finds any. */
    readonly inputPaths: ReadonlyArray<string>;
} | {
    readonly ok: false;
    /** Readable on one line per error, each with its file and line. */
    readonly message: string;
    readonly errors: ReadonlyArray<ClientBuildError>;
};
/** The parts of esbuild's API this uses, so that the vendored copy needs no esbuild types. */
export interface Esbuild {
    readonly version: string;
    readonly build: (options: never) => Promise<EsbuildResult>;
}
interface EsbuildFile {
    readonly path: string;
    readonly text: string;
}
interface EsbuildOutput {
    readonly inputs: Record<string, {
        readonly bytesInOutput: number;
    }>;
}
interface EsbuildResult {
    readonly outputFiles?: ReadonlyArray<EsbuildFile>;
    readonly metafile?: {
        readonly inputs?: Record<string, unknown>;
        readonly outputs: Record<string, EsbuildOutput>;
    };
}
/**
 * Every option, for this repo and entry. `tsconfigRaw` keeps esbuild from reading
 * any tsconfig on disk, the repo root's or a nested one: it gets only the checked
 * `baseUrl` and `paths`, which it resolves from `absWorkingDir`, the repo root, as
 * it would the root's own file.
 * the repo's `tsconfig.json`; `write: false`, no splitting and data URLs for
 * assets make the output one script and at most one stylesheet.
 */
export declare const clientBuildOptions: (root: string, entry: string, tsconfig?: ClientTsconfig) => {
    absWorkingDir: string;
    entryPoints: string[];
    outdir: string;
    entryNames: string;
    write: boolean;
    bundle: boolean;
    splitting: boolean;
    format: string;
    platform: string;
    target: string;
    minify: boolean;
    treeShaking: boolean;
    sourcemap: boolean;
    legalComments: string;
    charset: string;
    jsx: string;
    jsxDev: boolean;
    define: {
        "process.env.NODE_ENV": string;
    };
    loader: {
        [k: string]: string;
    };
    tsconfigRaw: string;
    metafile: boolean;
    logLevel: string;
};
/** How much of one error a message keeps. esbuild quotes the source, which can be any size. */
export declare const CLIENT_ERROR_MAX_CHARS = 2048;
/**
 * A path esbuild reports, relative to the repo, that a bundle has no business
 * reading: out of the checkout (`../../etc/passwd`, `/proc/self/environ`) or the
 * checkout's own git metadata. esbuild follows symlinks, so a link can't hide one.
 */
export declare const isOutsideRepo: (path: string) => boolean;
export declare const outsideRepoInputs: (paths: ReadonlyArray<string>) => ReadonlyArray<string>;
export declare const OUTSIDE_REPO_MESSAGE = "A file outside the repo can't be bundled.";
/** The files esbuild reads a tsconfig from, by name, when nothing says otherwise. */
export declare const TSCONFIG_FILES: readonly ["tsconfig.json", "jsconfig.json"];
/**
 * tsconfig is JSON with comments and trailing commas. Strings are skipped
 * whole, so a `//` inside one (a URL) stays.
 */
export declare const parseJsonc: (source: string) => unknown;
/**
 * Checks the `baseUrl` and `paths` browser code will get. `buildClient` checks
 * again, so what reaches esbuild passed here whoever called it.
 */
export declare const checkClientTsconfig: (value: unknown) => ClientTsconfigResult;
/**
 * The repo root's tsconfig (`tsconfig.json`, or `jsconfig.json` when there's
 * none, as esbuild picks), reduced to what browser code may use. `extends` is
 * refused: it would make the Worker's build read another file, which browser
 * code wouldn't, so the two would resolve differently.
 */
export declare const readClientTsconfig: (text: string | null, file?: (typeof TSCONFIG_FILES)[number]) => ClientTsconfigResult;
/**
 * A tsconfig below the root applies to the files under it in the Worker's
 * build, and never to browser code, so a file it covers would resolve
 * differently in the two. `configFiles` are repo paths of every tsconfig.json
 * and jsconfig.json, `node_modules` aside.
 */
export declare const nestedTsconfigProblem: (inputPaths: ReadonlyArray<string>, configFiles: ReadonlyArray<string>) => string | null;
/** `src/client.tsx:3:14: Expected ">"`, per error. */
export declare const formatClientErrors: (errors: ReadonlyArray<ClientBuildError>) => string;
/** Bundles `entry` and writes the module. A problem in the source is a result, not a throw. */
export interface ClientBuildRequest {
    readonly root: string;
    readonly entry: string;
    /** From `readClientTsconfig`. Checked again here. */
    readonly tsconfig?: ClientTsconfig;
    /** Every tsconfig.json and jsconfig.json in the repo outside `node_modules`, as repo paths. */
    readonly configFiles?: ReadonlyArray<string>;
}
export declare const buildClient: (esbuild: Esbuild, { root, entry, tsconfig, configFiles }: ClientBuildRequest) => Promise<ClientBuildResult>;
export {};
