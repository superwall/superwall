// Generated from packages/artifact-sdk by its vendor script. Do not edit.

// src/wire.ts
var BRIDGE_PROTOCOL = "superwall-artifact@1";
var DASHBOARD_ORIGINS = [
  "https://superwall.com",
  "https://app.superwall.com",
  "https://superwall.dev",
  "https://app.superwall.dev"
];
var CLIENT_BUNDLE_MAX_BYTES = 8 * 1024 * 1024;

// src/client.ts
var isHostMessage = (data) => typeof data === "object" && data !== null && data.protocol === BRIDGE_PROTOCOL && typeof data._tag === "string" && typeof data.nonce === "string";
var LOCAL_ORIGIN = /^http:\/\/localhost:\d+$/;
var isLocalHost = (origin) => LOCAL_ORIGIN.test(origin) && LOCAL_ORIGIN.test(window.location?.origin ?? "");
var connect = (options = {}) => new Promise((resolve) => {
  const hostOrigins = options.hostOrigins ?? DASHBOARD_ORIGINS;
  const onConnect = (event) => {
    if (event.source !== window.parent) return;
    if (!hostOrigins.includes(event.origin) && !isLocalHost(event.origin)) return;
    if (!isHostMessage(event.data) || event.data._tag !== "connect") return;
    window.removeEventListener("message", onConnect);
    const { nonce } = event.data;
    const hostOrigin = event.origin;
    let context = event.data.context;
    let theme = event.data.theme;
    const contextListeners = /* @__PURE__ */ new Set();
    const themeListeners = /* @__PURE__ */ new Set();
    const visibilityListeners = /* @__PURE__ */ new Set();
    const send = (message) => window.parent.postMessage({ ...message, protocol: BRIDGE_PROTOCOL, nonce }, hostOrigin);
    window.addEventListener("message", (next) => {
      if (next.source !== window.parent || next.origin !== hostOrigin) return;
      if (!isHostMessage(next.data) || next.data.nonce !== nonce) return;
      const message = next.data;
      if (message._tag === "context.update") {
        context = message.context;
        contextListeners.forEach((listener) => listener(context));
      } else if (message._tag === "theme") {
        theme = message.theme;
        themeListeners.forEach((listener) => listener(theme));
      } else if (message._tag === "visibility") {
        visibilityListeners.forEach((listener) => listener(message.visible));
      }
    });
    if (options.autoResize !== false) {
      const report = () => send({ _tag: "resize", height: document.documentElement.scrollHeight });
      new ResizeObserver(report).observe(document.documentElement);
    }
    const subscribe = (set) => (listener) => {
      set.add(listener);
      return () => void set.delete(listener);
    };
    send({ _tag: "ready" });
    resolve({
      get context() {
        return context;
      },
      get theme() {
        return theme;
      },
      send,
      onContext: subscribe(contextListeners),
      onTheme: subscribe(themeListeners),
      onVisibility: subscribe(visibilityListeners)
    });
  };
  window.addEventListener("message", onConnect);
});
export {
  connect
};
