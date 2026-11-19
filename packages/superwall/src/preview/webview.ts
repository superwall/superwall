const WEBVIEW_STYLES = `<style data-superwall-preview="webview">
  html { scrollbar-width: none; }
  ::-webkit-scrollbar { width: 0; height: 0; }
</style>`;

const VIEWPORT = /<meta name="viewport" content="([^"]*)"\s*\/?>/i;

export const injectWebviewSimulation = (html: string): string =>
  html
    .replace(VIEWPORT, (match, content: string) =>
      content.includes("maximum-scale")
        ? match
        : `<meta name="viewport" content="${content}, maximum-scale=1" />`,
    )
    .replace(/<\/head>/i, `${WEBVIEW_STYLES}</head>`);
