// Generated from packages/workspace-sdk by its vendor script. Do not edit.

// src/wire.ts
var CLIENT_ASSET_PREFIX = "/_client/";
var CLIENT_ESBUILD_VERSION = "0.28.2";
var CLIENT_BUNDLE_MAX_BYTES = 8 * 1024 * 1024;

// src/client-build.ts
var DATA_URLS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".svg",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf"
];
var clientBuildOptions = (root, entry) => ({
  absWorkingDir: root,
  entryPoints: [entry],
  outdir: "client",
  entryNames: "client",
  write: false,
  bundle: true,
  splitting: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  treeShaking: true,
  sourcemap: false,
  legalComments: "none",
  charset: "utf8",
  jsx: "automatic",
  jsxDev: false,
  define: { "process.env.NODE_ENV": '"production"' },
  loader: Object.fromEntries(DATA_URLS.map((extension) => [extension, "dataurl"])),
  tsconfigRaw: "{}",
  metafile: true,
  logLevel: "silent"
});
var hashOf = async (text) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(
    new Uint8Array(digest).slice(0, 8),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
};
var utf8Bytes = (text) => new TextEncoder().encode(text).byteLength;
var readError = (message) => ({
  file: message.location?.file ?? null,
  line: message.location?.line ?? null,
  column: message.location?.column ?? null,
  text: message.text,
  lineText: message.location?.lineText ?? null
});
var isBuildFailure = (error) => typeof error === "object" && error !== null && Array.isArray(error.errors);
var UNRESOLVED = /^Could not resolve "(?!\.)/;
var formatClientErrors = (errors) => {
  const shown = errors.slice(0, 5).map((error) => {
    const where = error.file === null ? "" : `${error.file}:${error.line ?? 0}:${error.column ?? 0}: `;
    const hint = UNRESOLVED.test(error.text) ? " (is it in package.json and package-lock.json?)" : "";
    return `${where}${error.text}${hint}`;
  });
  const more = errors.length > shown.length ? `
\u2026and ${errors.length - shown.length} more` : "";
  return `${shown.join("\n")}${more}`;
};
var failed = (errors) => ({
  ok: false,
  message: formatClientErrors(errors),
  errors
});
var failure = (text) => failed([{ file: null, line: null, column: null, text, lineText: null }]);
var buildClient = async (esbuild, { root, entry }) => {
  if (esbuild.version !== CLIENT_ESBUILD_VERSION) {
    throw new Error(
      `Workspace browser code is bundled with esbuild ${CLIENT_ESBUILD_VERSION}, not ${esbuild.version}.`
    );
  }
  let result;
  try {
    result = await esbuild.build(clientBuildOptions(root, entry));
  } catch (error) {
    if (!isBuildFailure(error)) throw error;
    return failed(error.errors.map(readError));
  }
  const files = result.outputFiles ?? [];
  const scripts = files.filter((file) => file.path.endsWith(".js"));
  const styles = files.filter((file) => file.path.endsWith(".css"));
  const script = scripts[0];
  if (script === void 0 || scripts.length !== 1 || styles.length > 1) {
    return failure(`The client build made ${files.map((file) => file.path).join(", ")}.`);
  }
  const style = styles[0]?.text ?? null;
  const bundle = {
    scriptPath: `${CLIENT_ASSET_PREFIX}${await hashOf(script.text)}.js`,
    script: script.text,
    stylePath: style === null ? null : `${CLIENT_ASSET_PREFIX}${await hashOf(style)}.css`,
    style
  };
  const inputs = /* @__PURE__ */ new Map();
  const outputs = result.metafile?.outputs ?? {};
  for (const output of Object.values(outputs)) {
    for (const [path, input] of Object.entries(output.inputs)) {
      inputs.set(path, (inputs.get(path) ?? 0) + input.bytesInOutput);
    }
  }
  return {
    ok: true,
    module: `export default ${JSON.stringify(bundle)}
`,
    scriptBytes: utf8Bytes(script.text),
    styleBytes: style === null ? 0 : utf8Bytes(style),
    inputs: Array.from(inputs, ([path, bytes]) => ({ path, bytes })).sort((a, b) => b.bytes - a.bytes).slice(0, 10)
  };
};
export {
  buildClient,
  clientBuildOptions,
  formatClientErrors
};
