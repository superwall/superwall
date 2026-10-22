import { readSession } from "@/core/account/storage";
import { getOAuthAccessToken } from "@/core/account/token";
import { API_HOST } from "@/environment";

const STATUS_PATH = "/v2/cli-agent/status";
const ANTHROPIC_PROXY_PATH = "/v2/cli-agent/anthropic";

interface HostedAgentStatus {
  limit: number;
  usage: number;
  remaining: number;
  exhausted: boolean;
  model: string;
}

function resolveBaseUrl(): string {
  return readSession()?.host || API_HOST();
}

export function resolveHostedAnthropicBaseUrl(): string {
  return `${resolveBaseUrl()}${ANTHROPIC_PROXY_PATH}`;
}

export async function selectHostedStatus(): Promise<HostedAgentStatus | null> {
  const token = await getOAuthAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`${resolveBaseUrl()}${STATUS_PATH}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as HostedAgentStatus;
  } catch {
    return null;
  }
}
