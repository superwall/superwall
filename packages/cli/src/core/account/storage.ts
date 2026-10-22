import { readJson, state } from "@/core/state/store";
import { API_HOST, API_HOST_OVERRIDE } from "@/environment";
import { formatJson } from "@/program/output";

export const sessionOrgName = (session: Session | null | undefined): string | undefined => {
  return session?.authMethod === "api_key" ? session.orgName : undefined;
};

export interface Session {
  authMethod?: "oauth" | "api_key";
  apiKey?: string;
  orgName?: string;
  userEmail?: string;
  host: string;
  createdAt: string;
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number;
  tokenEndpoint?: string;
  oauthClientId?: string;
}

const FILE = "auth.json";

export function writeSession(session: Session): void {
  state().write(FILE, `${formatJson(session)}\n`);
}

export function readSession(): Session | null {
  return readJson<Session>(state(), FILE) ?? null;
}

export function removeSession(): void {
  state().remove(FILE);
}

export function resolveApiHost(session: Session): string {
  return API_HOST_OVERRIDE() ?? session.host ?? API_HOST();
}

export function serializeSession(session: Session): Record<string, unknown> {
  return {
    authenticated: true,
    user: { email: session.userEmail ?? null },
    credential: {
      type: session.apiKey ? "api_key" : session.accessToken ? "oauth" : "unknown",
    },
    host: resolveApiHost(session),
  };
}
