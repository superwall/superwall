// Generated from packages/artifact-sdk by its vendor script. Do not edit.

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
var clientBuildOptions = (root, entry, tsconfig = {}) => ({
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
  tsconfigRaw: JSON.stringify({ compilerOptions: tsconfig }),
  metafile: true,
  logLevel: "silent"
});
var CLIENT_ERROR_MAX_CHARS = 2048;
var clip = (text, max = CLIENT_ERROR_MAX_CHARS) => text.length <= max ? text : `${text.slice(0, max)}\u2026 (${text.length - max} more characters)`;
var isOutsideRepo = (path) => path === ".." || path.startsWith("../") || path.startsWith("/") || path === ".git" || path.startsWith(".git/");
var outsideRepoInputs = (paths) => paths.filter(isOutsideRepo);
var OUTSIDE_REPO_MESSAGE = "A file outside the repo can't be bundled.";
var hashOf = async (text) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(
    new Uint8Array(digest).slice(0, 8),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
};
var utf8Bytes = (text) => new TextEncoder().encode(text).byteLength;
var readError = (message) => {
  const file = message.location?.file ?? null;
  const hidden = file !== null && isOutsideRepo(file);
  const lineText = message.location?.lineText ?? null;
  return {
    file: file === null ? null : clip(file),
    line: message.location?.line ?? null,
    column: message.location?.column ?? null,
    text: hidden ? OUTSIDE_REPO_MESSAGE : clip(message.text),
    lineText: hidden || lineText === null ? null : clip(lineText)
  };
};
var isBuildFailure = (error) => typeof error === "object" && error !== null && Array.isArray(error.errors);
var UNRESOLVED = /^Could not resolve "(?!\.)/;
var TSCONFIG_FILES = ["tsconfig.json", "jsconfig.json"];
var TSCONFIG_MAX_PATHS = 100;
var TSCONFIG_MAX_TARGETS = 10;
var TSCONFIG_MAX_CHARS = 256;
var parseJsonc = (source) => {
  const text = source.startsWith("\uFEFF") ? source.slice(1) : source;
  let out = "";
  let index = 0;
  const lineEnd = (from) => {
    const match = /[\r\n]/.exec(text.slice(from));
    return match === null ? text.length : from + match.index;
  };
  const nextSignificant = (from) => {
    let at = from;
    while (at < text.length) {
      if (/\s/.test(text[at])) at++;
      else if (text.startsWith("//", at)) {
        at = lineEnd(at);
      } else if (text.startsWith("/*", at)) {
        const end = text.indexOf("*/", at + 2);
        if (end === -1) return void 0;
        at = end + 2;
      } else return text[at];
    }
    return void 0;
  };
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      const end = /^"(?:[^"\\]|\\.)*"/.exec(text.slice(index));
      if (end === null) throw new Error("unterminated string");
      out += end[0];
      index += end[0].length;
    } else if (text.startsWith("//", index)) {
      index = lineEnd(index);
    } else if (text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2);
      if (end === -1) throw new Error("unterminated comment");
      index = end + 2;
    } else {
      const next = char === "," ? nextSignificant(index + 1) : void 0;
      if (!(next === "}" || next === "]")) out += char;
      index++;
    }
  }
  return JSON.parse(out);
};
var isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var repoPathProblem = (path, what) => {
  if (path.length === 0 || path.length > TSCONFIG_MAX_CHARS)
    return `${what} must be 1 to ${TSCONFIG_MAX_CHARS} characters`;
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.includes("\\")) {
    return `${what} ${JSON.stringify(path)} must be a path relative to the repo`;
  }
  const segments = path.split("/");
  if (segments.includes("..")) return `${what} ${JSON.stringify(path)} points outside the repo`;
  if (segments.includes(".git")) return `${what} ${JSON.stringify(path)} points into .git`;
  return null;
};
var wildcards = (text) => text.split("*").length - 1;
var checkClientTsconfig = (value) => {
  const refuse = (message) => ({
    ok: false,
    message: `tsconfig: ${message}.`
  });
  if (!isObject(value)) return refuse("compilerOptions must be an object");
  const tsconfig = {};
  if (value.baseUrl !== void 0) {
    if (typeof value.baseUrl !== "string") return refuse("baseUrl must be a string");
    const problem = repoPathProblem(value.baseUrl, "baseUrl");
    if (problem !== null) return refuse(problem);
    tsconfig.baseUrl = value.baseUrl;
  }
  if (value.paths !== void 0) {
    if (!isObject(value.paths)) return refuse("paths must be an object");
    const entries = Object.entries(value.paths);
    if (entries.length > TSCONFIG_MAX_PATHS)
      return refuse(`paths can have at most ${TSCONFIG_MAX_PATHS} entries`);
    const paths = /* @__PURE__ */ Object.create(null);
    for (const [pattern, targets] of entries) {
      if (pattern.length === 0 || pattern.length > TSCONFIG_MAX_CHARS || wildcards(pattern) > 1) {
        return refuse(
          `the paths pattern ${JSON.stringify(pattern.slice(0, 64))} must be 1 to ${TSCONFIG_MAX_CHARS} characters with at most one *`
        );
      }
      if (!Array.isArray(targets) || targets.length === 0 || targets.length > TSCONFIG_MAX_TARGETS || !targets.every((target) => typeof target === "string")) {
        return refuse(
          `paths[${JSON.stringify(pattern)}] must be a list of 1 to ${TSCONFIG_MAX_TARGETS} paths`
        );
      }
      for (const target of targets) {
        if (wildcards(target) > 1)
          return refuse(
            `paths[${JSON.stringify(pattern)}] target ${JSON.stringify(target)} has more than one *`
          );
        const problem = repoPathProblem(target, `paths[${JSON.stringify(pattern)}] target`);
        if (problem !== null) return refuse(problem);
      }
      paths[pattern] = [...targets];
    }
    tsconfig.paths = paths;
  }
  return { ok: true, tsconfig };
};
var readClientTsconfig = (text, file = "tsconfig.json") => {
  if (text === null) return { ok: true, tsconfig: {} };
  let parsed;
  try {
    parsed = parseJsonc(text);
  } catch (error) {
    return {
      ok: false,
      message: `${file} is not valid JSON: ${clip(error instanceof Error ? error.message : String(error))}.`
    };
  }
  if (!isObject(parsed)) return { ok: false, message: `${file} must be a JSON object.` };
  if (parsed.extends !== void 0) {
    return {
      ok: false,
      message: `${file}: "extends" isn't supported in an artifact with browser code. Put baseUrl and paths in ${file} itself.`
    };
  }
  if (parsed.compilerOptions === void 0) return { ok: true, tsconfig: {} };
  const checked = checkClientTsconfig(parsed.compilerOptions);
  return checked.ok ? checked : { ok: false, message: checked.message.replace(/^tsconfig:/, `${file}:`) };
};
var nestedTsconfigProblem = (inputPaths, configFiles) => {
  const dirs = configFiles.filter((file) => file.includes("/")).map((file) => ({ file, dir: file.slice(0, file.lastIndexOf("/") + 1) }));
  for (const input of inputPaths) {
    if (input.startsWith("node_modules/") || input.includes("/node_modules/")) continue;
    const covering = dirs.find(({ dir }) => input.startsWith(dir));
    if (covering !== void 0) {
      return `${covering.file} applies to ${input} in the Worker's build but not in browser code. Keep one tsconfig.json at the repo root for browser code.`;
    }
  }
  return null;
};
var formatClientErrors = (errors) => {
  const shown = errors.slice(0, 5).map((error) => {
    const where = error.file === null ? "" : `${error.file}:${error.line ?? 0}:${error.column ?? 0}: `;
    const hint = UNRESOLVED.test(error.text) ? " (is it in package.json and package-lock.json?)" : "";
    return clip(`${where}${error.text}${hint}`);
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
var buildClient = async (esbuild, { root, entry, tsconfig = {}, configFiles = [] }) => {
  if (esbuild.version !== CLIENT_ESBUILD_VERSION) {
    throw new Error(
      `Artifact browser code is bundled with esbuild ${CLIENT_ESBUILD_VERSION}, not ${esbuild.version}.`
    );
  }
  const checked = checkClientTsconfig(tsconfig);
  if (!checked.ok) return failure(checked.message);
  let result;
  try {
    result = await esbuild.build(clientBuildOptions(root, entry, checked.tsconfig));
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
  const inputPaths = Array.from(
    /* @__PURE__ */ new Set([...Object.keys(result.metafile?.inputs ?? {}), ...inputs.keys()])
  );
  const nested = nestedTsconfigProblem(inputPaths, configFiles);
  if (nested !== null) return failure(nested);
  return {
    ok: true,
    module: `export default ${JSON.stringify(bundle)}
`,
    scriptBytes: utf8Bytes(script.text),
    styleBytes: style === null ? 0 : utf8Bytes(style),
    inputs: Array.from(inputs, ([path, bytes]) => ({ path, bytes })).sort((a, b) => b.bytes - a.bytes).slice(0, 10),
    inputPaths
  };
};
export {
  CLIENT_ERROR_MAX_CHARS,
  OUTSIDE_REPO_MESSAGE,
  TSCONFIG_FILES,
  buildClient,
  checkClientTsconfig,
  clientBuildOptions,
  formatClientErrors,
  isOutsideRepo,
  nestedTsconfigProblem,
  outsideRepoInputs,
  parseJsonc,
  readClientTsconfig
};
