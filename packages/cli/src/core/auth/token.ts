import { NotLoggedInError } from "./errors";
import { loadSession, saveSession, type Session } from "./storage";

const EXPIRY_SKEW_MS = 60_000;

export { NotLoggedInError } from "./errors";

function accessTokenIsFresh(session: Session): boolean {
  return (
    session.accessTokenExpiresAt !== undefined &&
    session.accessTokenExpiresAt - EXPIRY_SKEW_MS > Date.now()
  );
}

async function refreshAccessToken(
  session: Session,
): Promise<(Session & { accessToken: string }) | null> {
  if (!session.refreshToken || !session.tokenEndpoint || !session.oauthClientId) return null;
  try {
    const res = await fetch(session.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: session.refreshToken,
        client_id: session.oauthClientId,
      }),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!d.access_token) return null;
    const updated = {
      ...session,
      accessToken: d.access_token,
      refreshToken: d.refresh_token ?? session.refreshToken,
      accessTokenExpiresAt: d.expires_in ? Date.now() + d.expires_in * 1000 : undefined,
    };
    saveSession(updated);
    return updated;
  } catch {
    return null;
  }
}

export async function getOAuthAccessToken(): Promise<string | null> {
  const session = loadSession();
  if (!session?.accessToken || !session.refreshToken) return null;
  if (accessTokenIsFresh(session)) return session.accessToken;
  const refreshed = await refreshAccessToken(session);
  return refreshed?.accessToken ?? null;
}

export async function resolveAuthToken(
  session: Session,
): Promise<{ token: string; session: Session }> {
  if (session.accessToken && session.refreshToken) {
    if (accessTokenIsFresh(session)) return { token: session.accessToken, session };
    const refreshed = await refreshAccessToken(session);
    if (refreshed) return { token: refreshed.accessToken, session: refreshed };
    // Refresh failed - fall through to an API key if one is stored.
  }
  if (session.apiKey) return { token: session.apiKey, session };
  throw new NotLoggedInError();
}
