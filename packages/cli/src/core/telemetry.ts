import { TELEMETRY_HOST, TELEMETRY_KEY, VERSION } from "@/environment";
import { getAnonymousId, setTelemetryNoticeShown, telemetryNoticeShown } from "@/core/state/config";
import { isNonInteractive } from "@/environment";

export interface TelemetryTags {
  framework?: string;
  driver?: string;
}

const tags: TelemetryTags = {};
const pending: Array<Promise<unknown>> = [];

export function setTelemetryTags(next: TelemetryTags): void {
  Object.assign(tags, next);
}

export function isTelemetryEnabled(env: NodeJS.ProcessEnv, key: string): boolean {
  return (
    Boolean(key) &&
    !env.DO_NOT_TRACK &&
    !env.SUPERWALL_TELEMETRY_DISABLED &&
    !env.NODE_TEST_CONTEXT
  );
}

export function telemetryEnabled(): boolean {
  return isTelemetryEnabled(process.env, TELEMETRY_KEY());
}

/**
 * Fully anonymous by design: distinct_id is a random persisted UUID never
 * linked to the logged-in account, properties are enums/booleans/numbers only
 * (no names, paths, or messages), and person profiles are disabled.
 */
export function buildEvent(
  event: string,
  props: Record<string, unknown>,
  distinctId: string,
): Record<string, unknown> {
  return {
    api_key: TELEMETRY_KEY(),
    event,
    distinct_id: distinctId,
    timestamp: new Date().toISOString(),
    properties: {
      $process_person_profile: false,
      cli_version: VERSION,
      platform: process.platform,
      ci: process.env.CI === "true",
      interactive: !isNonInteractive(),
      ...tags,
      ...props,
    },
  };
}

export function track(event: string, props: Record<string, unknown> = {}): void {
  if (!telemetryEnabled()) return;
  try {
    const payload = buildEvent(event, props, getAnonymousId());
    pending.push(
      fetch(`${TELEMETRY_HOST()}/capture/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        // Shorter than the flush cap so a black-holed endpoint can never hold
        // the process open past flushTelemetry()'s bound.
        signal: AbortSignal.timeout(1500),
      }).catch(() => {}),
    );
  } catch {
    // Telemetry must never break the CLI.
  }
}

export async function flushTelemetry(capMs = 2000): Promise<void> {
  if (pending.length === 0) return;
  await Promise.race([
    Promise.allSettled(pending),
    new Promise((done) => setTimeout(done, capMs).unref()),
  ]);
}

export function maybeShowTelemetryNotice(ui: { info(message: string): void }): void {
  if (!telemetryEnabled() || telemetryNoticeShown()) return;
  setTelemetryNoticeShown();
  ui.info(
    "The CLI collects anonymous usage data - no personal data, ever (see the README). Opt out with `SUPERWALL_TELEMETRY_DISABLED=1`.",
  );
}
