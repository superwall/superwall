import { API_HOST, AUTH_HOST, CLI_CLIENT_ID, OAUTH_SCOPE } from "@/environment";
import { getOnboardedOrg, getOnboardingIdempotencyKey, setOnboardedOrg } from "@/core/state/config";
import { openBrowser } from "./browser";
import {
  clearPendingLogin,
  loadPendingLogin,
  savePendingLogin,
  saveSession,
  type Session,
} from "./storage";

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

interface Discovery {
  token_endpoint: string;
  device_authorization_endpoint?: string;
}

interface DeviceAuth {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  interval?: number;
  expires_in?: number;
}

interface LoginOrg {
  id: number | string;
  name: string;
}

export interface LoginOptions {
  issuer?: string;
  apiHost?: string;
  clientId?: string;
  onVerify?: (info: { url: string; userCode: string; browserOpened: boolean }) => void;
  onStatus?: (message: string) => void;
  onOnboard?: () => Promise<OnboardSetup | null>;
  onProvisioned?: (result: ProvisionedApp) => void;
  openBrowser?: (url: string) => Promise<boolean>;
}

export interface OnboardSetup {
  orgName: string;
  app?: { name: string; platform: "ios" | "android" | "web"; bundleId?: string };
}

export interface ProvisionedApp {
  publicApiKey?: string;
  projectId?: string;
  applicationId?: string;
  orgId?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  idToken?: string;
}

export interface PendingLogin {
  apiHost: string;
  clientId: string;
  tokenEndpoint: string;
  deviceCode: string;
  userCode: string;
  url: string;
  interval: number;
  expiresAt: number;
  lastPolledAt: number;
  orgName?: string;
  tokens?: Tokens;
}

export type PollResult =
  | { status: "pending"; pending: PendingLogin }
  | { status: "needs_organization"; pending: PendingLogin }
  | { status: "logged_in"; session: Session };

async function beginDeviceLogin(
  opts: LoginOptions,
): Promise<{ pending: PendingLogin; browserOpened: boolean }> {
  const issuer = opts.issuer ?? AUTH_HOST();
  const clientId = opts.clientId ?? CLI_CLIENT_ID();

  const disc = await discover(issuer);
  if (!disc.device_authorization_endpoint) {
    throw new Error("auth.superwall.com does not advertise a device-authorization endpoint.");
  }

  const dev = await startDeviceAuth(disc.device_authorization_endpoint, clientId);
  const url = dev.verification_uri_complete ?? dev.verification_uri;
  const browserOpened = await (opts.openBrowser ?? openBrowser)(url);
  const now = Date.now();
  return {
    browserOpened,
    pending: {
      apiHost: opts.apiHost ?? API_HOST(),
      clientId,
      tokenEndpoint: disc.token_endpoint,
      deviceCode: dev.device_code,
      userCode: dev.user_code,
      url,
      interval: dev.interval ?? 5,
      expiresAt: now + (dev.expires_in ?? 600) * 1000,
      lastPolledAt: now,
    },
  };
}

export async function performLogin(opts: LoginOptions = {}): Promise<Session> {
  const { pending, browserOpened } = await beginDeviceLogin(opts);
  opts.onVerify?.({ url: pending.url, userCode: pending.userCode, browserOpened });
  const tokens = await pollForToken(pending, pending.expiresAt, opts.onStatus);
  if (!tokens) throw new Error("The login request expired - run `superwall login` again.");
  const finished = await finishLogin(pending, tokens, opts);
  if (!("session" in finished)) {
    throw new Error(
      "Your account has no organization yet - run `superwall login` interactively to create one.",
    );
  }
  return finished.session;
}

export async function startLogin(
  opts: LoginOptions & { orgName?: string } = {},
): Promise<{ pending: PendingLogin; browserOpened: boolean }> {
  const started = await beginDeviceLogin(opts);
  if (opts.orgName) started.pending.orgName = opts.orgName;
  savePendingLogin(started.pending);
  return started;
}

export async function pollLogin(
  opts: LoginOptions & { timeoutMs: number; orgName?: string },
): Promise<PollResult> {
  const pending = loadPendingLogin<PendingLogin>();
  if (!pending) throw new Error("No login in progress. Run `superwall login` first.");
  if (opts.orgName) pending.orgName = opts.orgName;

  let tokens = pending.tokens;
  if (!tokens) {
    if (Date.now() >= pending.expiresAt) {
      clearPendingLogin();
      throw new Error("The login request expired. Run `superwall login` again for a new code.");
    }
    try {
      tokens = (await pollForToken(
        pending,
        Math.min(pending.expiresAt, Date.now() + opts.timeoutMs),
        opts.onStatus,
      )) ?? undefined;
    } catch (error) {
      clearPendingLogin();
      throw error;
    }
    if (!tokens) {
      savePendingLogin(pending);
      return { status: "pending", pending };
    }
  } else if (tokens.refreshToken) {
    const fresh = await refreshAccessToken(pending.tokenEndpoint, pending.clientId, tokens.refreshToken);
    if (fresh) tokens = { ...tokens, accessToken: fresh };
  }

  const finished = await finishLogin(pending, tokens, { ...opts, orgName: pending.orgName });
  if ("session" in finished) {
    clearPendingLogin();
    return { status: "logged_in", session: finished.session };
  }
  pending.tokens = tokens;
  savePendingLogin(pending);
  return { status: "needs_organization", pending };
}

async function finishLogin(
  pending: Pick<PendingLogin, "apiHost" | "clientId" | "tokenEndpoint">,
  tokens: Tokens,
  opts: LoginOptions & { orgName?: string },
): Promise<{ session: Session } | { needsOrganization: true }> {
  const { apiHost, clientId, tokenEndpoint } = pending;
  const { refreshToken, expiresIn, idToken } = tokens;
  let apiToken = tokens.accessToken;

  if (idToken) await getJson(`${apiHost}/v2/me`, idToken).catch(() => null);

  const me = (await getJson(`${apiHost}/v2/me`, apiToken).catch(() => null)) as {
    email?: string;
  } | null;
  let orgList: LoginOrg[] = [];
  try {
    const res = (await getJson(`${apiHost}/v2/me/organizations`, apiToken)) as {
      data: LoginOrg[];
    };
    orgList = res.data ?? [];
  } catch {
    // A brand-new account has no org yet.
    orgList = [];
  }
  const uniqueOrgs = [...new Map(orgList.map((o) => [String(o.id), o])).values()];

  let org: LoginOrg | undefined;
  let createdNewOrg = false;
  if (uniqueOrgs.length === 0) {
    // Membership listings lag for up to a minute after provisioning; trust
    // what this machine created rather than onboarding the same user twice.
    const remembered = getOnboardedOrg();
    if (remembered) {
      org = { id: remembered.id, name: remembered.name };
    } else if (opts.onOnboard) {
      const setup = await opts.onOnboard();
      if (!setup) throw new Error("Cancelled.");
      opts.onStatus?.("Creating your account…");
      if (setup.app) {
        const provisioned = await provisionAccount(apiHost, apiToken, setup);
        if (provisioned.orgId) org = { id: provisioned.orgId, name: setup.orgName };
        opts.onProvisioned?.(provisioned);
      } else {
        org = await createOrganization(apiHost, apiToken, setup.orgName);
      }
      if (org) setOnboardedOrg({ id: String(org.id), name: org.name });
      createdNewOrg = true;
    } else if (opts.orgName) {
      org = await createOrganization(apiHost, apiToken, opts.orgName);
      setOnboardedOrg({ id: String(org.id), name: org.name });
      createdNewOrg = true;
    } else {
      return { needsOrganization: true };
    }
  } else if (uniqueOrgs.length === 1) {
    org = uniqueOrgs[0]!;
  }

  // The API caches auth context for 60s per token; refresh so the key-mint sees the new org.
  if (createdNewOrg && refreshToken) {
    opts.onStatus?.("Activating your organization…");
    const fresh = await refreshAccessToken(tokenEndpoint, clientId, refreshToken);
    if (fresh) apiToken = fresh;
  }

  const session: Session = {
    authMethod: "oauth",
    orgId: org ? String(org.id) : undefined,
    orgName: org?.name,
    orgCount: createdNewOrg ? 1 : uniqueOrgs.length,
    userEmail: me?.email,
    host: apiHost,
    createdAt: new Date().toISOString(),
    accessToken: apiToken,
    refreshToken,
    accessTokenExpiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
    tokenEndpoint,
    oauthClientId: clientId,
  };
  saveSession(session);
  return { session };
}

export async function loginWithApiKey(apiKey: string, apiHost = API_HOST()): Promise<Session> {
  const key = apiKey.trim();
  if (!key) throw new Error("An API key is required.");

  let org: { id?: string; name?: string } = {};
  try {
    const res = (await getJson(`${apiHost}/v2/me/organizations`, key)) as {
      data?: Array<{ id: number | string; name: string }>;
    };
    const first = res.data?.[0];
    if (first) org = { id: String(first.id), name: first.name };
  } catch {
    throw new Error("That API key was rejected. Check it and try again.");
  }

  const session: Session = {
    authMethod: "api_key",
    apiKey: key,
    orgId: org.id,
    orgName: org.name,
    host: apiHost,
    createdAt: new Date().toISOString(),
  };
  saveSession(session);
  return session;
}

async function discover(issuer: string): Promise<Discovery> {
  const r = await fetch(`${issuer}/.well-known/openid-configuration`, {
    headers: { accept: "application/json" },
  });
  if (!r.ok) throw new Error(`OIDC discovery failed (HTTP ${r.status}).`);
  return (await r.json()) as Discovery;
}

async function startDeviceAuth(endpoint: string, clientId: string): Promise<DeviceAuth> {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, scope: OAUTH_SCOPE }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(
      `Device authorization failed (HTTP ${r.status}). Register a CLI OAuth client with the device grant. ${detail}`.trim(),
    );
  }
  return (await r.json()) as DeviceAuth;
}

async function pollForToken(
  pending: Pick<PendingLogin, "tokenEndpoint" | "clientId" | "deviceCode" | "interval" | "lastPolledAt">,
  deadline: number,
  onStatus?: (m: string) => void,
): Promise<Tokens | null> {
  for (;;) {
    const wait = Math.max(0, pending.lastPolledAt + pending.interval * 1000 - Date.now());
    if (Date.now() + wait >= deadline) return null;
    await sleep(wait);
    pending.lastPolledAt = Date.now();
    const r = await fetch(pending.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: DEVICE_GRANT,
        device_code: pending.deviceCode,
        client_id: pending.clientId,
      }),
    });
    const d = (await r.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      id_token?: string;
      error?: string;
      error_description?: string;
    };
    if (r.ok && d.access_token)
      return {
        accessToken: d.access_token,
        refreshToken: d.refresh_token,
        expiresIn: d.expires_in,
        idToken: d.id_token,
      };
    switch (d.error) {
      case "authorization_pending":
        onStatus?.("Waiting for you to approve in the browser…");
        continue;
      case "slow_down":
        pending.interval += 5;
        continue;
      case "expired_token":
        throw new Error("The login request expired - run `superwall login` again.");
      case "access_denied":
        throw new Error("Login was denied.");
      default:
        throw new Error(d.error_description || d.error || "Token polling failed.");
    }
  }
}

async function createOrganization(apiHost: string, token: string, name: string): Promise<LoginOrg> {
  const created = (await postJson(`${apiHost}/v2/me/organizations`, token, {
    name,
  })) as { id: number | string; name: string };
  return { id: created.id, name: created.name };
}

async function provisionAccount(
  apiHost: string,
  token: string,
  setup: OnboardSetup,
): Promise<ProvisionedApp> {
  const app = setup.app!;
  const res = (await postJson(`${apiHost}/internal/v2/onboarding/provision`, token, {
    idempotency_key: getOnboardingIdempotencyKey(),
    organization: { name: setup.orgName },
    applications: [
      {
        name: app.name,
        platform: app.platform,
        ...(app.bundleId ? { bundle_id: app.bundleId } : {}),
      },
    ],
    marketing_metadata: { source: "cli" },
  })) as {
    project?: {
      id?: number | string;
      organization_id?: number | string;
      applications?: Array<{ id?: number | string; public_api_key?: string }>;
    };
  };
  const created = res.project?.applications?.[0];
  return {
    publicApiKey: created?.public_api_key,
    projectId: res.project?.id !== undefined ? String(res.project.id) : undefined,
    applicationId: created?.id !== undefined ? String(created.id) : undefined,
    orgId:
      res.project?.organization_id !== undefined ? String(res.project.organization_id) : undefined,
  };
}

async function refreshAccessToken(
  tokenEndpoint: string,
  clientId: string,
  refreshToken: string,
): Promise<string | null> {
  try {
    const r = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
      }),
    });
    if (!r.ok) return null;
    const d = (await r.json()) as { access_token?: string };
    return d.access_token ?? null;
  } catch {
    return null;
  }
}

async function getJson(url: string, accessToken: string): Promise<unknown> {
  const r = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
    },
  });
  if (!r.ok) throw new Error(`GET ${url} failed (HTTP ${r.status}).`);
  return r.json();
}

async function postJson(url: string, accessToken: string, body: unknown): Promise<unknown> {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`POST ${url} failed (HTTP ${r.status}). ${detail}`.trim());
  }
  return r.json();
}
