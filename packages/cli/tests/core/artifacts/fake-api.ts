import type { SuperwallApi } from "@/core/api/client";
import { ApiError } from "@/core/api/client";
import type { Artifact, ArtifactBuild, ArtifactVersion } from "@/core/artifacts/api";
import type { Manifest } from "@/core/artifacts/project";
import { recordingRenderer, type RendererCall } from "../../helpers/renderer";
import type { LocalGitRemote } from "../../helpers/git-remote";

let nextArtifactId = 40;

const api400 = (path: string, status: number, message: string) => new ApiError(`API ${path}`, status, JSON.stringify({ message }));

export interface FakeApiOptions {
  remote: LocalGitRemote;
  manifest?: Manifest;
  buildSequence?: readonly Partial<ArtifactBuild>[];
  onBuilds?: (commit: string) => void | Promise<void>;
  me?: { name?: string | null; email?: string | null };
  tokenIdOf?: (mint: number) => string;
  staff?: boolean;
  projects?: unknown[];
  /** What GET installations answers. Left out, it's a 404, as if it couldn't be read. */
  installations?: unknown[];
}

export function fakeArtifactApi({ remote, manifest, buildSequence, onBuilds, me = { name: "Pat Pusher", email: "pat@example.com" }, tokenIdOf = (mint) => `tok_${mint}`, staff = false, projects = [], installations }: FakeApiOptions) {
  const artifacts: Artifact[] = [];
  const versions: ArtifactVersion[] = [];
  const calls: string[] = [];
  const revoked: string[] = [];
  const buildReads = new Map<number, number>();
  let mint = 0;

  const toBuild = (version: ArtifactVersion, overrides: Partial<ArtifactBuild> = {}): ArtifactBuild => ({
    artifact_id: version.artifact_id,
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
    list: async () => projects,
    async get(path: string) {
      calls.push(`GET ${path}`);
      const url = new URL(path, "http://x");
      if (url.pathname === "/v2/me") return { ...me, role: staff ? "SUPERADMIN" : "CUSTOMER" };
      if (url.pathname === "/v2/me/organizations") return { data: [] };
      if (url.pathname === "/v2/artifacts") {
        const slug = url.searchParams.get("slug");
        return { data: artifacts.filter((artifact) => !slug || artifact.slug === slug) };
      }
      const build = /^\/v2\/artifacts\/(\d+)\/versions\/(\d+)\/build$/.exec(url.pathname);
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
          const owner = artifacts.find((artifact) => artifact.id === version.artifact_id);
          if (owner && !staff) owner.author_version_id = version.id;
        }
        if (step.status === "failed") {
          version.build_status = "FAILED";
          version.build_error = step.failure?.message ?? null;
        }
        return toBuild(version, step);
      }
      if (installations !== undefined && /^\/v2\/artifacts\/\d+\/installations$/.test(url.pathname)) return { data: installations };
      const versionList = /^\/v2\/artifacts\/(\d+)\/versions$/.exec(url.pathname);
      if (versionList) return { data: versions.filter((version) => version.artifact_id === Number(versionList[1])) };
      const one = /^\/v2\/artifacts\/(\d+)$/.exec(url.pathname);
      const found = one && artifacts.find((artifact) => artifact.id === Number(one[1]));
      if (found) return found;
      throw api400(path, 404, "Not found");
    },
    async post(path: string, body: Record<string, unknown>) {
      calls.push(`POST ${path}`);
      if (path === "/v2/artifacts") {
        const artifact: Artifact = {
          id: (nextArtifactId += 1),
          organization_id: Number(body.organization_id),
          slug: String(body.slug),
          name: String(body.name),
          state: "no_version",
          active_version_id: null,
          author_version_id: null,
        };
        artifacts.push(artifact);
        return artifact;
      }
      const access = /^\/v2\/artifacts\/(\d+)\/source-access$/.exec(path);
      if (access) {
        mint += 1;
        const secret = `art_v1_secret_${mint}`;
        remote.tokens.add(secret);
        const repo = `ws-${access[1]}`;
        if (remote.headOf(repo) === undefined) remote.createRepo(repo);
        return {
          object: "artifact.source_access",
          id: Number(access[1]),
          repo,
          remote: remote.remoteOf(repo),
          branch: "main",
          token: `${secret}?expires=1790000000`,
          token_id: tokenIdOf(mint),
          expires_at: "2026-11-05T00:10:00Z",
        };
      }
      const builds = /^\/v2\/artifacts\/(\d+)\/builds$/.exec(path);
      if (builds) {
        const commit = String(body.commit_sha);
        await onBuilds?.(commit);
        const repo = `ws-${builds[1]}`;
        if (remote.headOf(repo) !== commit) throw api400(path, 409, "The head moved");
        revoked.push(String(body.token_id));
        const existing = versions.find((version) => version.commit_sha === commit);
        const version: ArtifactVersion = existing ?? {
          id: 100 + versions.length + 1,
          artifact_id: Number(builds[1]),
          commit_sha: commit,
          commit_message: remote.log(repo),
          build_status: "PENDING",
          build_error: null,
          manifest: null,
          compatibility_date: null,
          compatibility_flags: [],
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
  return { api: api as unknown as SuperwallApi, artifacts, versions, apiCalls: calls, revoked };
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
