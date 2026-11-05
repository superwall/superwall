import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const hasGitHttpBackend = (): boolean =>
  spawnSync("git", ["--exec-path"]).status === 0 &&
  spawnSync("git", ["http-backend"], {
    env: { ...process.env, REQUEST_METHOD: "GET", GIT_HTTP_EXPORT_ALL: "1" },
  }).error === undefined;

const authorized = (request: IncomingMessage, tokens: ReadonlySet<string>) => {
  const [kind, value] = (request.headers.authorization ?? "").split(" ");
  return kind === "Bearer" && tokens.has(value ?? "");
};

export interface LocalGitRemote {
  remoteOf(name: string): string;
  createRepo(name: string): void;
  headOf(name: string, branch?: string): string | undefined;
  filesOf(name: string, branch?: string): string[];
  show(name: string, file: string, branch?: string): string;
  log(name: string, branch?: string): string;
  authorOf(name: string, branch?: string): string;
  tokens: Set<string>;
  requests: { path: string; authorized: boolean }[];
  close(): Promise<void>;
}

export const startLocalGitRemote = async (): Promise<LocalGitRemote> => {
  const root = mkdtempSync(join(tmpdir(), "superwall-git-remote-"));
  const tokens = new Set<string>();
  const requests: { path: string; authorized: boolean }[] = [];
  const server: Server = createServer((request, response) => {
    const allowed = authorized(request, tokens);
    const url = new URL(request.url ?? "/", "http://localhost");
    requests.push({ path: url.pathname, authorized: allowed });
    if (!allowed) {
      response.writeHead(401, { "WWW-Authenticate": 'Basic realm="git"' }).end();
      return;
    }
    const backend = spawn("git", ["http-backend"], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: "1",
        REMOTE_USER: "x",
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: request.method ?? "GET",
        CONTENT_TYPE: request.headers["content-type"] ?? "",
        HTTP_CONTENT_ENCODING: request.headers["content-encoding"] ?? "",
      },
    });
    request.pipe(backend.stdin);
    let head = Buffer.alloc(0);
    let sentHeaders = false;
    backend.stdout.on("data", (chunk: Buffer) => {
      if (sentHeaders) {
        response.write(chunk);
        return;
      }
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf("\r\n\r\n");
      if (end === -1) return;
      const lines = head.subarray(0, end).toString().split("\r\n");
      const status = lines.find((line) => line.toLowerCase().startsWith("status:"));
      const headers = Object.fromEntries(
        lines
          .filter((line) => !line.toLowerCase().startsWith("status:"))
          .map((line) => {
            const colon = line.indexOf(":");
            return [line.slice(0, colon), line.slice(colon + 1).trim()];
          }),
      );
      response.writeHead(status === undefined ? 200 : Number(status.split(" ")[1]), headers);
      response.write(head.subarray(end + 4));
      sentHeaders = true;
    });
    backend.stdout.on("end", () => response.end());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const repo = (name: string) => join(root, `${name}.git`);
  const git = (name: string, ...args: string[]) =>
    execFileSync("git", ["--git-dir", repo(name), ...args], { encoding: "utf8" });
  return {
    remoteOf: (name) => `http://127.0.0.1:${port}/${name}.git`,
    createRepo: (name) => {
      spawnSync("git", ["init", "--quiet", "--bare", "--initial-branch=main", repo(name)]);
    },
    headOf: (name, branch = "main") => {
      const result = spawnSync("git", ["--git-dir", repo(name), "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], {
        encoding: "utf8",
      });
      return result.status === 0 ? result.stdout.trim() : undefined;
    },
    filesOf: (name, branch = "main") => git(name, "ls-tree", "-r", "--name-only", branch).split("\n").filter(Boolean),
    show: (name, file, branch = "main") => git(name, "show", `${branch}:${file}`),
    log: (name, branch = "main") => git(name, "log", "-1", "--format=%B", branch),
    authorOf: (name, branch = "main") => git(name, "log", "-1", "--format=%an <%ae>", branch).trim(),
    tokens,
    requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      rmSync(root, { recursive: true, force: true });
    },
  };
};
