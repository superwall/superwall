import { setTimeout as sleep } from "node:timers/promises";
import { UsageError, type CommandContext } from "@/program/command";
import { onboardingHooks } from "@/core/account/onboarding";
import { ensureSkillsCurrent } from "@/core/support/skills";
import { BROWSER_UNAVAILABLE } from "@/core/account/browser";
import { serializeSession } from "@/core/account/storage";
import { scanProject } from "@/core/codebase/scan";
import { readOnboardedOrg, readOnboardingIdempotencyKey, writeOnboardedOrg } from "@/core/state/config";
import { track } from "@/core/support/telemetry";
import { API_HOST, AUTH_HOST, CLI_CLIENT_ID, OAUTH_SCOPE } from "@/environment";
import { openBrowser } from "./browser";
import {
  readPendingLogin,
  removePendingLogin,
  writePendingLogin,
  writeSession,
  type PendingLogin,
  type Session,
  type Tokens,
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

interface LoginOptions {
  issuer?: string;
  apiHost?: string;
  clientId?: string;
  orgName?: string;
  app?: OnboardSetup["app"];
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

export type PollResult =
  | { status: "pending"; pending: PendingLogin }
  | { status: "needs_organization"; pending: PendingLogin }
  | { status: "logged_in"; session: Session };

type FinishResult = { session: Session } | { needsOrganization: true };

async function createPendingLogin(
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
      ...(opts.orgName ? { orgName: opts.orgName } : {}),
      ...(opts.app ? { app: opts.app } : {}),
    },
  };
}

export async function performLogin(opts: LoginOptions = {}): Promise<Session> {
  const { pending, browserOpened } = await createPendingLogin(opts);
  opts.onVerify?.({ url: pending.url, userCode: pending.userCode, browserOpened });

  const tokens = await pollForToken(pending, pending.expiresAt, opts.onStatus);
  if (!tokens) throw new Error("Login timed out.");

  const finished = await finishLogin(pending, tokens, opts);
  if ("needsOrganization" in finished) {
    throw new Error(
      "Your account has no organization yet - run `superwall login` interactively to create one.",
    );
  }
  return finished.session;
}

export async function startLogin(
  opts: LoginOptions = {},
): Promise<{ pending: PendingLogin; browserOpened: boolean }> {
  const started = await createPendingLogin(opts);
  writePendingLogin(started.pending);
  return started;
}

export async function pollLogin(
  opts: LoginOptions & { timeoutMs: number },
): Promise<PollResult> {
  const pending = readPendingLogin();
  if (!pending) throw new Error("No login in progress. Run `superwall login` first.");
  if (opts.orgName) pending.orgName = opts.orgName;
  if (opts.app) pending.app = opts.app;

  const tokens = await resolvePollTokens(pending, opts);
  if (!tokens) {
    writePendingLogin(pending);
    return { status: "pending", pending };
  }

  const finished = await finishLogin(pending, tokens, { ...opts, orgName: pending.orgName, app: pending.app });
  if ("session" in finished) {
    removePendingLogin();
    return { status: "logged_in", session: finished.session };
  }
  pending.tokens = tokens;
  writePendingLogin(pending);
  return { status: "needs_organization", pending };
}

async function resolvePollTokens(
  pending: PendingLogin,
  opts: LoginOptions & { timeoutMs: number },
): Promise<Tokens | null> {
  const held = pending.tokens;
  if (held) {
    if (!held.refreshToken) return held;
    const fresh = await refreshAccessToken(pending.tokenEndpoint, pending.clientId, held.refreshToken);
    return fresh ? { ...held, ...fresh, expiresIn: fresh.expiresIn } : held;
  }
  if (Date.now() >= pending.expiresAt) {
    removePendingLogin();
    throw new Error("The login request expired. Run `superwall login` again for a new code.");
  }
  try {
    return await pollForToken(
      pending,
      Math.min(pending.expiresAt, Date.now() + opts.timeoutMs),
      opts.onStatus,
    );
  } catch (error) {
    removePendingLogin();
    throw error;
  }
}

async function resolveOnboardSetup(opts: LoginOptions): Promise<OnboardSetup | null | undefined> {
  if (opts.onOnboard) return opts.onOnboard();
  if (opts.orgName) return { orgName: opts.orgName, ...(opts.app ? { app: opts.app } : {}) };
  return undefined;
}

async function finishLogin(
  pending: Pick<PendingLogin, "apiHost" | "clientId" | "tokenEndpoint">,
  tokens: Tokens,
  opts: LoginOptions,
): Promise<FinishResult> {
  const { apiHost, clientId, tokenEndpoint } = pending;
  const { idToken } = tokens;
  let { refreshToken, expiresIn } = tokens;
  let apiToken = tokens.accessToken;

  if (idToken) await findJson(`${apiHost}/v2/me`, idToken).catch(() => null);

  const me = (await findJson(`${apiHost}/v2/me`, apiToken).catch(() => null)) as {
    email?: string;
  } | null;
  let hasOrg = false;
  try {
    const res = (await findJson(`${apiHost}/v2/me/organizations`, apiToken)) as {
      data?: LoginOrg[];
    };
    hasOrg = (res.data ?? []).length > 0;
  } catch {
    hasOrg = false;
  }

  let createdNewOrg = false;
  if (!hasOrg && !readOnboardedOrg()) {
    const setup = await resolveOnboardSetup(opts);
    if (setup === undefined) return { needsOrganization: true };
    if (!setup) throw new Error("Cancelled.");
    opts.onStatus?.("Creating your account…");
    let org: LoginOrg | undefined;
    if (setup.app) {
      const provisioned = await provisionAccount(apiHost, apiToken, setup.orgName, setup.app);
      if (provisioned.orgId) org = { id: provisioned.orgId, name: setup.orgName };
      opts.onProvisioned?.(provisioned);
    } else {
      org = await createOrganization(apiHost, apiToken, setup.orgName);
    }
    if (org) writeOnboardedOrg({ id: String(org.id), name: org.name });
    createdNewOrg = true;
  }

  if (createdNewOrg && refreshToken) {
    opts.onStatus?.("Activating your organization…");
    const fresh = await refreshAccessToken(tokenEndpoint, clientId, refreshToken);
    if (fresh) {
      apiToken = fresh.accessToken;
      refreshToken = fresh.refreshToken;
      expiresIn = fresh.expiresIn;
    }
  }

  const session: Session = {
    authMethod: "oauth",
    userEmail: me?.email,
    host: apiHost,
    createdAt: new Date().toISOString(),
    accessToken: apiToken,
    refreshToken,
    accessTokenExpiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
    tokenEndpoint,
    oauthClientId: clientId,
  };
  writeSession(session);
  return { session };
}

async function loginWithApiKey(apiKey: string, apiHost = API_HOST()): Promise<Session> {
  const key = apiKey.trim();
  if (!key) throw new Error("An API key is required.");

  let org: { id?: string; name?: string } = {};
  try {
    const res = (await findJson(`${apiHost}/v2/me/organizations`, key)) as {
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
    orgName: org.name,
    host: apiHost,
    createdAt: new Date().toISOString(),
  };
  writeSession(session);
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
  let wait = Math.max(0, pending.lastPolledAt + pending.interval * 1000 - Date.now());
  while (Date.now() + wait < deadline) {
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
    if (r.ok && d.access_token) {
      return {
        accessToken: d.access_token,
        refreshToken: d.refresh_token,
        expiresIn: d.expires_in,
        idToken: d.id_token,
      };
    }
    switch (d.error) {
      case "authorization_pending":
        onStatus?.("Waiting for you to approve in the browser…");
        break;
      case "slow_down":
        pending.interval += 5;
        break;
      case "expired_token":
        throw new Error("The login request expired - run `superwall login` again.");
      case "access_denied":
        throw new Error("Login was denied.");
      default:
        throw new Error(d.error_description || d.error || "Token polling failed.");
    }
    wait = pending.interval * 1000;
  }
  return null;
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
  orgName: string,
  app: NonNullable<OnboardSetup["app"]>,
): Promise<ProvisionedApp> {
  const res = (await postJson(`${apiHost}/internal/v2/onboarding/provision`, token, {
    idempotency_key: readOnboardingIdempotencyKey(),
    organization: { name: orgName },
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
): Promise<{ accessToken: string; refreshToken: string; expiresIn?: number } | null> {
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
    const d = (await r.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!d.access_token) return null;
    return {
      accessToken: d.access_token,
      refreshToken: d.refresh_token ?? refreshToken,
      ...(d.expires_in === undefined ? {} : { expiresIn: d.expires_in }),
    };
  } catch {
    return null;
  }
}

async function findJson(url: string, accessToken: string): Promise<unknown> {
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

interface LoginInput {
  flags: {
    apiKey: string | undefined;
    host: string | undefined;
    clientId: string | undefined;
    poll?: boolean;
    timeout?: number;
    orgName?: string;
    appName?: string;
    platform?: string;
    bundleId?: string;
  };
  openBrowser?: (url: string) => Promise<boolean>;
}

type AgentLogin = { orgName?: string; app?: OnboardSetup["app"]; issuer?: string; clientId?: string };

const POLL_HINT = "superwall login --poll";
const POLL_TIMEOUT_SECONDS = 60;

function isPlatform(value: string): value is NonNullable<OnboardSetup["app"]>["platform"] {
  return value === "ios" || value === "android" || value === "web";
}

function resolveAgentLogin(flags: LoginInput["flags"]): AgentLogin {
  const orgName = flags.orgName?.trim() || undefined;
  const appName = flags.appName?.trim() || undefined;
  const base = { orgName, issuer: flags.host, clientId: flags.clientId };
  if (!appName) {
    if (flags.platform || flags.bundleId) throw new UsageError("--platform and --bundle-id need --app-name.");
    return base;
  }
  if (!orgName) throw new UsageError("--app-name needs --org-name.");
  if (!flags.platform || !isPlatform(flags.platform)) {
    throw new UsageError("--app-name needs --platform ios, android or web.");
  }
  const bundleId = flags.bundleId?.trim() || undefined;
  return { ...base, app: { name: appName, platform: flags.platform, ...(bundleId ? { bundleId } : {}) } };
}

const formatExpiry = (pending: PendingLogin): string => new Date(pending.expiresAt).toISOString();

async function runAgentLoginStart(
  ctx: CommandContext<"none">,
  agent: AgentLogin,
  openBrowser: LoginInput["openBrowser"],
): Promise<void> {
  const { pending, browserOpened } = await startLogin({ ...agent, ...(openBrowser ? { openBrowser } : {}) });
  track("login started", { method: "oauth_poll" });
  if (ctx.json) {
    return ctx.output.data({
      status: "pending",
      verification_url: pending.url,
      user_code: pending.userCode,
      expires_at: formatExpiry(pending),
      browser_opened: browserOpened,
      next: POLL_HINT,
    });
  }
  ctx.ui.info(`Approve this login in your browser · code \`${pending.userCode}\`\n${pending.url}`);
  if (!browserOpened) ctx.ui.warn(BROWSER_UNAVAILABLE);
  ctx.ui.outro(`Once it's approved, run \`${POLL_HINT}\` to finish. The code expires at ${formatExpiry(pending)}.`);
}

async function runAgentLoginPoll(
  ctx: CommandContext<"none">,
  agent: AgentLogin,
  timeoutSeconds: number | undefined,
): Promise<void> {
  const { ui } = ctx;
  const seconds = timeoutSeconds !== undefined && timeoutSeconds >= 0 ? timeoutSeconds : POLL_TIMEOUT_SECONDS;
  const scan = await scanProject(ctx.installDir).catch(() => null);
  const hooks = onboardingHooks(scan?.apps[0]);
  const spin = ui.spinner();
  spin.start("Waiting for you to approve in the browser");
  let result: PollResult;
  try {
    result = await pollLogin({
      ...agent,
      timeoutMs: seconds * 1000,
      onStatus: (m) => spin.message(m),
      onProvisioned: hooks.onProvisioned,
    });
  } catch (e) {
    spin.stop("Login failed");
    track("login finished", { status: "error", method: "oauth_poll" });
    throw e;
  }

  if (result.status === "logged_in") {
    spin.stop(`Logged in as \`${result.session.userEmail ?? "you"}\``);
    track("login finished", { status: "success", method: "oauth_poll" });
    const provisioned = hooks.provisioned();
    if (ctx.json) {
      return ctx.output.data({
        status: "logged_in",
        ...serializeSession(result.session),
        ...(provisioned?.publicApiKey
          ? {
              app: {
                public_api_key: provisioned.publicApiKey,
                application_id: provisioned.applicationId ?? null,
                project_id: provisioned.projectId ?? null,
              },
            }
          : {}),
      });
    }
    await ensureSkillsCurrent(false, "login").catch(() => {});
    ui.outro(
      provisioned?.publicApiKey
        ? "Your app is ready - run `superwall integrate` to set up the SDK."
        : "You're all set - run `superwall integrate` to set up your app.",
    );
    return;
  }

  ctx.fail();
  if (result.status === "needs_organization") {
    spin.stop("Approved");
    const next = `${POLL_HINT} --org-name "<name>"`;
    const message = `This account has no organization yet. Run \`${next}\` to create one, with --app-name and --platform to create its first app too.`;
    if (ctx.json) return ctx.output.data({ status: "needs_organization", message, next });
    ui.warn(message);
    return;
  }
  const { pending } = result;
  spin.stop("Not approved yet");
  if (ctx.json) {
    return ctx.output.data({
      status: "pending",
      verification_url: pending.url,
      user_code: pending.userCode,
      expires_at: formatExpiry(pending),
      next: POLL_HINT,
    });
  }
  ui.info(
    `Still waiting for approval · code \`${pending.userCode}\`\n${pending.url}\nRun \`${POLL_HINT}\` again. The code expires at ${formatExpiry(pending)}.`,
  );
}

export async function runLogin(
  ctx: CommandContext<"none">,
  { flags, openBrowser }: LoginInput,
): Promise<void> {
  const { ui } = ctx;
  ui.intro("Superwall login");

  const apiKeyArg = flags.apiKey;
  if (apiKeyArg) {
    const spin = ui.spinner();
    spin.start("Verifying your API key");
    try {
      const session = await loginWithApiKey(apiKeyArg);
      spin.stop("Logged in");
      track("login finished", { status: "success", method: "api_key" });
      if (ctx.json) return ctx.output.data(serializeSession(session));
      ui.success(
        `Logged in with an API key${session.orgName ? ` · \`${session.orgName}\`` : ""}.`,
      );
      ui.outro("You're all set - run `superwall integrate` to set up your app.");
    } catch (e) {
      spin.stop("Login failed");
      track("login finished", { status: "error", method: "api_key" });
      throw e;
    }
    return;
  }

  const agent = resolveAgentLogin(flags);
  if (flags.poll) return runAgentLoginPoll(ctx, agent, flags.timeout);
  if (!ctx.interactive) return runAgentLoginStart(ctx, agent, openBrowser);

  const scan = await scanProject(ctx.installDir).catch(() => null);
  const hooks = onboardingHooks(scan?.apps[0]);
  const spin = ui.spinner();
  try {
    const session = await performLogin({
      issuer: flags.host,
      clientId: flags.clientId,
      openBrowser,
      onVerify: ({ url, userCode, browserOpened }) => {
        ui.info(`Approve this login in your browser · code \`${userCode}\`\n${url}`);
        if (!browserOpened) ui.warn(BROWSER_UNAVAILABLE);
        spin.start("Waiting for you to approve in the browser");
      },
      onStatus: (m) => spin.message(m),
      onOnboard: async () => {
        const setup = await hooks.onOnboard();
        if (setup) spin.start("Creating your account");
        return setup;
      },
      onProvisioned: hooks.onProvisioned,
    });
    spin.stop(`Logged in as \`${session.userEmail ?? "you"}\``);
    track("login finished", { status: "success", method: "oauth" });
    if (!ctx.json) await ensureSkillsCurrent(false, "login").catch(() => {});
    ui.outro(
      hooks.provisioned()?.publicApiKey
        ? "Your app is ready - run `superwall integrate` to set up the SDK."
        : "You're all set - run `superwall integrate` to set up your app.",
    );
  } catch (e) {
    spin.stop("Login failed");
    track("login finished", { status: "error", method: "oauth" });
    throw e;
  }
}
