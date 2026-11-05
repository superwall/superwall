import type { SuperwallApi } from "@/core/api/client";
import { ApiError } from "@/core/api/client";
import type { Workspace, WorkspaceBuild, WorkspaceVersion } from "@/core/workspaces/api";
import type { Manifest } from "@/core/workspaces/project";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";
import type { LocalGitRemote } from "../../helpers/git-remote";

let nextWorkspaceId = 40;

const api400 = (path: string, status: number, message: string) => new ApiError(`API ${path}`, status, JSON.stringify({ message }));

export interface FakeApiOptions {
  remote: LocalGitRemote;
  manifest?: Manifest;
  buildSequence?: readonly Partial<WorkspaceBuild>[];
  onBuilds?: (commit: string) => void | Promise<void>;
  me?: { name?: string | null; email?: string | null };
}

export function fakeWorkspaceApi({ remote, manifest, buildSequence, onBuilds, me = { name: "Pat Pusher", email: "pat@example.com" } }: FakeApiOptions) {
  const workspaces: Workspace[] = [];
  const versions: WorkspaceVersion[] = [];
  const calls: string[] = [];
  const revoked: string[] = [];
  const buildReads = new Map<number, number>();
  let mint = 0;

  const toBuild = (version: WorkspaceVersion, overrides: Partial<WorkspaceBuild> = {}): WorkspaceBuild => ({
    workspace_id: version.workspace_id,
    version_id: version.id,
    commit_sha: version.commit_sha,
    status: "queued",
    step: null,
    failure: null,
    steps: [],
    queued_at: "2026-11-05T00:00:00Z",
    started_at: null,
    finished_at: null,
    log: null,
    version,
    ...overrides,
  });

  const api = {
    host: "https://api2.superwall.dev",
    async get(path: string) {
      calls.push(`GET ${path}`);
      const url = new URL(path, "http://x");
      if (url.pathname === "/v2/me") return me;
      if (url.pathname === "/v2/workspaces") {
        const slug = url.searchParams.get("slug");
        return { data: workspaces.filter((workspace) => !slug || workspace.slug === slug) };
      }
      const build = /^\/v2\/workspaces\/(\d+)\/versions\/(\d+)\/build$/.exec(url.pathname);
      if (build) {
        const id = Number(build[2]);
        const version = versions.find((candidate) => candidate.id === id);
        if (!version) throw api400(path, 404, "No such version");
        const read = buildReads.get(id) ?? 0;
        buildReads.set(id, read + 1);
        const sequence = buildSequence ?? [
          { status: "running", step: "install" },
          { status: "succeeded", step: null, finished_at: "2026-11-05T00:01:00Z", log: "built ok\n" },
        ];
        const step = sequence[Math.min(read, sequence.length - 1)]!;
        if (step.status === "succeeded") {
          version.build_status = "SUCCEEDED";
          version.manifest = manifest ?? null;
        }
        if (step.status === "failed") {
          version.build_status = "FAILED";
          version.build_error = step.failure?.message ?? null;
        }
        return toBuild(version, step);
      }
      const versionList = /^\/v2\/workspaces\/(\d+)\/versions$/.exec(url.pathname);
      if (versionList) return { data: versions.filter((version) => version.workspace_id === Number(versionList[1])) };
      const one = /^\/v2\/workspaces\/(\d+)$/.exec(url.pathname);
      const found = one && workspaces.find((workspace) => workspace.id === Number(one[1]));
      if (found) return found;
      throw api400(path, 404, "Not found");
    },
    async post(path: string, body: Record<string, unknown>) {
      calls.push(`POST ${path}`);
      if (path === "/v2/workspaces") {
        const workspace: Workspace = {
          id: (nextWorkspaceId += 1),
          organization_id: Number(body.organization_id),
          slug: String(body.slug),
          name: String(body.name),
          state: "no_version",
          active_version_id: null,
          author_version_id: null,
        };
        workspaces.push(workspace);
        return workspace;
      }
      const access = /^\/v2\/workspaces\/(\d+)\/source-access$/.exec(path);
      if (access) {
        mint += 1;
        const secret = `art_v1_secret_${mint}`;
        remote.tokens.add(secret);
        const repo = `ws-${access[1]}`;
        if (remote.headOf(repo) === undefined) remote.createRepo(repo);
        return {
          object: "workspace.source_access",
          id: Number(access[1]),
          repo,
          remote: remote.remoteOf(repo),
          branch: "main",
          token: `${secret}?expires=1790000000`,
          token_id: `tok_${mint}`,
          expires_at: "2026-11-05T00:10:00Z",
        };
      }
      const builds = /^\/v2\/workspaces\/(\d+)\/builds$/.exec(path);
      if (builds) {
        const commit = String(body.commit_sha);
        await onBuilds?.(commit);
        const repo = `ws-${builds[1]}`;
        if (remote.headOf(repo) !== commit) throw api400(path, 409, "The head moved");
        revoked.push(String(body.token_id));
        const existing = versions.find((version) => version.commit_sha === commit);
        const version: WorkspaceVersion = existing ?? {
          id: 100 + versions.length + 1,
          workspace_id: Number(builds[1]),
          commit_sha: commit,
          commit_message: remote.log(repo),
          build_status: "PENDING",
          build_error: null,
          manifest: null,
          deploy_requested_at: null,
          created_at: "2026-11-05T00:00:00Z",
          grant: null,
        };
        if (!existing) versions.push(version);
        return toBuild(version);
      }
      throw api400(path, 404, "Not found");
    },
  };
  return { api: api as unknown as SuperwallApi, workspaces, versions, apiCalls: calls, revoked };
}

export function fakeContext(api: SuperwallApi, options: { json?: boolean; interactive?: boolean; mode?: string; confirm?: boolean | null } = {}) {
  const calls: RendererCall[] = [];
  const ui = recordingRenderer(calls);
  if (options.confirm !== undefined) {
    ui.confirm = async (value) => {
      calls.push({ method: "confirm", value });
      return options.confirm as boolean | null;
    };
  }
  const data: unknown[] = [];
  const text: string[] = [];
  let failed = 0;
  const ctx = {
    ui,
    api,
    json: options.json ?? false,
    interactive: options.interactive ?? false,
    outputMode: options.mode ?? (options.json ? "json" : "text"),
    output: { data: (value: unknown) => data.push(value), text: (value: string) => text.push(value) },
    fail: () => {
      failed += 1;
    },
  } as never;
  return {
    ctx,
    data,
    text,
    failed: () => failed,
    said: (method: string) => calls.filter((call) => call.method === method).map((call) => String(call.value)),
    calls,
  };
}
