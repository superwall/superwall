const WEBVIEW_STYLES = `<style data-superwall-preview="webview">
  html { scrollbar-width: none; }
  ::-webkit-scrollbar { width: 0; height: 0; }
</style>`;

export const injectWebviewSimulation = (html: string): string =>
  html.replace(/<\/head>/i, `${WEBVIEW_STYLES}</head>`);
