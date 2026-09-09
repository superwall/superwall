import { backgroundOf, type SuperwallConfig } from "@superwall/runtime";

export const SUPERWALL_GENERATION = 5;

export const documentAttributes = (
  config: SuperwallConfig | undefined,
): Record<string, string> => ({
  "data-sw-generation": String(SUPERWALL_GENERATION),
  "data-sw-scroll": String(config?.scrollEnabled ?? true),
});

export const PLATFORM_STYLESHEET_URL = "https://runtime-static.superwall.com/live.css";

export const ROUTE_ASSETS_ID = "sw-route-assets";

export type DocumentOptions = {
  title: string;
  config: SuperwallConfig;
  entry: string;
};

export const renderDocument = ({ title, config, entry }: DocumentOptions): string => {
  const attributes = Object.entries(documentAttributes(config))
    .map(([name, value]) => ` ${name}="${value}"`)
    .join("");

  const background = backgroundOf(config.background);
  const style = background ? ` style="background-color:${background.light}"` : "";

  return `<!doctype html>
<html${attributes}${style}>
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
