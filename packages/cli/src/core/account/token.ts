import { LoginUnreachableError, NotLoggedInError } from "./errors";
import { readSession, writeSession, type Session } from "./storage";

const EXPIRY_SKEW_MS = 60_000;
const REFRESH_TIMEOUT_MS = 15_000;

export { LoginUnreachableError, NotLoggedInError } from "./errors";

export interface RefreshOptions {
  timeoutMs?: number;
}

function accessTokenIsFresh(session: Session): boolean {
  return (
    session.accessTokenExpiresAt !== undefined &&
    session.accessTokenExpiresAt - EXPIRY_SKEW_MS > Date.now()
  );
}

async function refreshAccessToken(
  session: Session,
  timeoutMs: number,
): Promise<(Session & { accessToken: string }) | null> {
  if (!session.refreshToken || !session.tokenEndpoint || !session.oauthClientId) return null;
  let res: Response;
  try {
    res = await fetch(session.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: session.refreshToken,
        client_id: session.oauthClientId,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new LoginUnreachableError(session.tokenEndpoint, error, timedOut ? timeoutMs : undefined);
  }
  if (!res.ok) return null;
  let d: { access_token?: string; refresh_token?: string; expires_in?: number };
  try {
    d = (await res.json()) as typeof d;
  } catch {
    return null;
  }
  if (!d.access_token) return null;
  const updated = {
    ...session,
    accessToken: d.access_token,
    refreshToken: d.refresh_token ?? session.refreshToken,
    accessTokenExpiresAt: d.expires_in ? Date.now() + d.expires_in * 1000 : undefined,
  };
  writeSession(updated);
  return updated;
}

export async function getOAuthAccessToken(options: RefreshOptions = {}): Promise<string | null> {
  const session = readSession();
  if (!session?.accessToken || !session.refreshToken) return null;
  if (accessTokenIsFresh(session)) return session.accessToken;
  try {
    const refreshed = await refreshAccessToken(session, options.timeoutMs ?? REFRESH_TIMEOUT_MS);
    return refreshed?.accessToken ?? null;
  } catch (error) {
    if (error instanceof LoginUnreachableError) return null;
    throw error;
  }
}

export async function resolveAuthToken(
  session: Session,
  options: RefreshOptions = {},
): Promise<{ token: string; session: Session }> {
  if (session.accessToken && session.refreshToken) {
    if (accessTokenIsFresh(session)) return { token: session.accessToken, session };
    try {
      const refreshed = await refreshAccessToken(session, options.timeoutMs ?? REFRESH_TIMEOUT_MS);
      if (refreshed) return { token: refreshed.accessToken, session: refreshed };
    } catch (error) {
      if (!(error instanceof LoginUnreachableError) || !session.apiKey) throw error;
    }
  }
  if (session.apiKey) return { token: session.apiKey, session };
  throw new NotLoggedInError();
}
