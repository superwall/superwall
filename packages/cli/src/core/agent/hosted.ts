import { API_HOST } from "@/constants";
import { loadSession } from "@/core/auth/storage";
import { getOAuthAccessToken } from "@/core/auth/token";

const STATUS_PATH = "/v2/cli-agent/status";
const ANTHROPIC_PROXY_PATH = "/v2/cli-agent/anthropic";

export interface HostedAgentStatus {
  limit: number;
  usage: number;
  remaining: number;
  exhausted: boolean;
  model: string;
}

function baseUrl(): string {
  return loadSession()?.host || API_HOST;
}

export function getHostedAnthropicBaseUrl(): string {
  return `${baseUrl()}${ANTHROPIC_PROXY_PATH}`;
}

export async function getHostedAuthToken(): Promise<string | null> {
  return getOAuthAccessToken();
}

export async function getHostedStatus(): Promise<HostedAgentStatus | null> {
  const token = await getOAuthAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`${baseUrl()}${STATUS_PATH}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as HostedAgentStatus;
  } catch {
    return null;
  }
}

export async function hostedAgentAvailable(): Promise<boolean> {
  const status = await getHostedStatus();
  return status !== null && !status.exhausted;
}
