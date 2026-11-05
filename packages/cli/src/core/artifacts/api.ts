import type { SuperwallApi } from "@/core/api/client";
import type { Manifest } from "./project";

export interface Artifact {
  id: number;
  organization_id: number;
  slug: string;
  name: string;
  state: "active" | "no_version" | "not_approved" | "turned_off";
  active_version_id: number | null;
  author_version_id?: number | null;
}

export interface ArtifactGrant {
  scopes: readonly string[];
  background_scopes: readonly string[];
  egress: readonly string[];
  secret_bindings: readonly { name: string; host: string; inject: string }[];
}

export type BuildStatus = "PENDING" | "BUILDING" | "SUCCEEDED" | "FAILED";

export interface ArtifactVersion {
  id: number;
  artifact_id: number;
  commit_sha: string;
  commit_message: string | null;
  build_status: BuildStatus;
  build_error: string | null;
  manifest: Manifest | null;
  compatibility_date: string | null;
  compatibility_flags: readonly string[];
  deploy_requested_at: string | null;
  created_at: string;
  grant: ArtifactGrant | null;
}

export interface ArtifactBuild {
  artifact_id: number;
  version_id: number;
  commit_sha: string;
  status: "queued" | "running" | "succeeded" | "failed";
  step: string | null;
  failure: { code: string; message: string } | null;
  steps: readonly { step: string; duration_ms: number }[];
  queued_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  log: string | null;
  version: ArtifactVersion;
}

export interface ArtifactSourceAccess {
  repo: string;
  remote: string;
  branch: string;
  token: string;
  token_id: string;
  expires_at: string;
}

export interface ArtifactInstallation {
  entrypoint_id: string;
  slot: string;
  application_id: number | null;
  enabled: boolean;
  position: number;
}

const artifactPath = (id: string | number) => `/v2/artifacts/${encodeURIComponent(String(id))}`;
const versionPath = (id: string | number, version: string | number) =>
  `${artifactPath(id)}/versions/${encodeURIComponent(String(version))}`;

export const getMe = (api: SuperwallApi) => api.get<{ name?: string | null; email?: string | null; role?: string }>("/v2/me");

export interface OrganizationMember {
  status: string;
  name: string | null;
  email: string | null;
  role: string;
  project_access_mode: string;
}

export const listMembers = async (api: SuperwallApi, organizationId: string | number) =>
  (await api.get<{ data?: OrganizationMember[] }>(`/v2/organizations/${encodeURIComponent(String(organizationId))}/access/members`)).data ?? [];

export const getArtifact = (api: SuperwallApi, id: string | number) => api.get<Artifact>(artifactPath(id));

export const listArtifacts = async (api: SuperwallApi, organizationId: string, slug?: string) => {
  const search = new URLSearchParams({ organization_id: organizationId, ...(slug ? { slug } : {}) });
  return (await api.get<{ data: Artifact[] }>(`/v2/artifacts?${search}`)).data;
};

export const createArtifact = (api: SuperwallApi, organizationId: string, name: string, slug: string) =>
  api.post<Artifact>("/v2/artifacts", { organization_id: Number(organizationId), name, slug });

export const listVersions = async (api: SuperwallApi, id: string | number) =>
  (await api.get<{ data: ArtifactVersion[] }>(`${artifactPath(id)}/versions`)).data;

export const mintSourceAccess = (api: SuperwallApi, id: string | number) =>
  api.post<ArtifactSourceAccess>(`${artifactPath(id)}/source-access`, {});

export const startBuild = (api: SuperwallApi, id: string | number, commitSha: string, tokenId: string) =>
  api.post<ArtifactBuild>(`${artifactPath(id)}/builds`, { commit_sha: commitSha, token_id: tokenId });

export const getBuild = (api: SuperwallApi, id: string | number, version: string | number) =>
  api.get<ArtifactBuild>(`${versionPath(id, version)}/build`);

export const requestDeploy = (api: SuperwallApi, id: string | number, version: string | number) =>
  api.post<ArtifactVersion>(`${versionPath(id, version)}/request-deploy`, {});

export const approveVersion = (api: SuperwallApi, id: string | number, version: string | number) =>
  api.post<ArtifactVersion>(`${versionPath(id, version)}/approve`, {});

export const listInstallations = async (api: SuperwallApi, id: string | number) =>
  (await api.get<{ data: ArtifactInstallation[] }>(`${artifactPath(id)}/installations`)).data;

export const setInstallation = (
  api: SuperwallApi,
  id: string | number,
  body: { entrypoint_id: string; application_id: number | null; enabled: boolean; position?: number },
) => api.put<ArtifactInstallation>(`${artifactPath(id)}/installations`, body);

export const deleteInstallation = (api: SuperwallApi, id: string | number, entrypoint: string, application?: string) => {
  const search = new URLSearchParams({ entrypoint_id: entrypoint, ...(application ? { application_id: application } : {}) });
  return api.del<{ data: ArtifactInstallation[] }>(`${artifactPath(id)}/installations?${search}`);
};
