import { documentAttributes, type SuperwallConfig } from "@superwall/runtime";

/**
 * The document contract: the exact HTML a paywall is, and the platform layer
 * the runtime wraps it in. The build writes this document into every
 * snapshot and the local preview server renders the same one, so a paywall
 * on a laptop is byte-comparable to the one Superwall serves.
 *
 * Two layers, mirroring production:
 *
 *   1. the snapshot — self-contained HTML carrying `data-sw-*` semantics on
 *      `<html>`, immutable once pushed;
 *   2. the platform layer — live.css, injected at serve time by the runtime
 *      worker (and by the preview server locally), so Superwall can restyle
 *      the fleet without anyone republishing.
 *
 * Nothing else may enter the document. Anything the preview needs that
 * production lacks belongs in the webview simulation, not here.
 */

/**
 * live.css's canonical home. The runtime serves it behind a stable, unhashed
 * URL precisely so tooling can hardcode it; `SUPERWALL_RUNTIME_URL` points
 * previews at a local runtime instead.
 */
export const PLATFORM_STYLESHEET_URL = "https://runtime-static.superwall.com/live.css";

export type DocumentOptions = {
  title: string;
  /** Merged surface config — its `data-sw-*` semantics land on `<html>`. */
  config: SuperwallConfig;
  /** Module script the document boots: the built entry, or the preview mount. */
  entry: string;
};

export const renderDocument = ({ title, config, entry }: DocumentOptions): string => {
  const attributes = Object.entries(documentAttributes(config))
    .map(([name, value]) => ` ${name}="${value}"`)
    .join("");

  return `<!doctype html>
<html${attributes}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${title}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${entry}"></script>
  </body>
</html>`;
};

/**
 * Applies the platform layer to a document — the same transform the runtime
 * worker performs on every snapshot it serves. The link lands at the top of
 * `<head>` so the paywall's own styles keep cascade priority; the fallbacks
 * cover documents that reach here without a `<head>`.
 */
export const injectPlatformLayer = (html: string, stylesheetUrl: string): string => {
  const tag = `<link rel="stylesheet" href="${stylesheetUrl}">`;

  const head = /<head[^>]*>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return `${html.slice(0, at)}${tag}${html.slice(at)}`;
  }

  const root = /<html[^>]*>/i.exec(html);
  if (root) {
    const at = root.index + root[0].length;
    return `${html.slice(0, at)}<head>${tag}</head>${html.slice(at)}`;
  }

  return `${tag}${html}`;
};
