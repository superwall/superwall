import { TELEMETRY_HOST, TELEMETRY_KEY, VERSION } from "@/constants";
import { loadSession } from "@/core/auth/storage";
import { getAnonymousId } from "@/core/state/config";

export type FeedbackVia = "human" | "agent";

export function buildFeedbackEvent(
  message: string,
  via: FeedbackVia,
  distinctId: string,
  session: { userEmail?: string; orgId?: string; orgName?: string } | null,
): Record<string, unknown> {
  return {
    api_key: TELEMETRY_KEY,
    event: "feedback submitted",
    distinct_id: distinctId,
    timestamp: new Date().toISOString(),
    properties: {
      $process_person_profile: false,
      message,
      via,
      cli_version: VERSION,
      platform: process.platform,
      email: session?.userEmail ?? null,
      org_id: session?.orgId ?? null,
      org_name: session?.orgName ?? null,
    },
  };
}

export async function submitFeedback(message: string, via: FeedbackVia): Promise<boolean> {
  if (!TELEMETRY_KEY) return false;
  const payload = buildFeedbackEvent(message, via, getAnonymousId(), loadSession());
  try {
    const res = await fetch(`${TELEMETRY_HOST}/capture/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
