import { defineCommand, type CommandContext } from "@/command";
import { API_HOST } from "@/environment";
import { ensureSkillsCurrent } from "@/core/agent/skills";
import { onboardingHooks } from "@/core/account/onboarding";
import { track } from "@/core/telemetry";
import { BROWSER_UNAVAILABLE } from "@/core/auth/browser";
import {
  loginWithApiKey,
  performLogin,
  pollLogin,
  startLogin,
  type PendingLogin,
} from "@/core/auth/login";
import { clearSession, loadSession, type Session } from "@/core/auth/storage";
import { scanProject } from "@/core/project/scan";

export const runLogin = defineCommand({
  name: "login",
  output: "both",
  async run(ctx) {
    const { ui } = ctx;
    ui.intro("Superwall login");

    const apiKeyArg = ctx.argv.apiKey as string | undefined;
    if (apiKeyArg) {
      const spin = ui.spinner();
      spin.start("Verifying your API key");
      try {
        const session = await loginWithApiKey(apiKeyArg);
        spin.stop("Logged in");
        track("login finished", { status: "success", method: "api_key" });
        if (ctx.json) return ctx.output.data(sessionOutput(session));
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

    const orgName = typeof ctx.argv.orgName === "string" ? ctx.argv.orgName.trim() || undefined : undefined;
    if (ctx.argv.poll === true) return pollForApproval(ctx, orgName);
    if (!ctx.interactive) return startForAgent(ctx, orgName);

    const scan = await scanProject(ctx.installDir).catch(() => null);
    const hooks = onboardingHooks(scan?.apps[0]);
    const spin = ui.spinner();
    try {
      const session = await performLogin({
        issuer: ctx.argv.host as string | undefined,
        clientId: ctx.argv.clientId as string | undefined,
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
      spin.stop(
        `Logged in as \`${session.userEmail ?? "you"}\`${session.orgName ? ` · \`${session.orgName}\`` : ""}`,
      );
      track("login finished", { status: "success", method: "oauth" });
      // Skill install failures never fail the login; `superwall skills` retries.
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
  },
});

const POLL_HINT = "superwall login --poll";

function expiresAt(pending: PendingLogin): string {
  return new Date(pending.expiresAt).toISOString();
}

async function startForAgent(ctx: CommandContext, orgName: string | undefined): Promise<void> {
  const { pending, browserOpened } = await startLogin({
    issuer: ctx.argv.host as string | undefined,
    clientId: ctx.argv.clientId as string | undefined,
    orgName,
  });
  track("login started", { method: "oauth_poll" });
  if (ctx.json) {
    return ctx.output.data({
      status: "pending",
      verification_url: pending.url,
      user_code: pending.userCode,
      expires_at: expiresAt(pending),
      browser_opened: browserOpened,
      next: POLL_HINT,
    });
  }
  ctx.ui.info(`Approve this login in your browser · code \`${pending.userCode}\`\n${pending.url}`);
  if (!browserOpened) ctx.ui.warn(BROWSER_UNAVAILABLE);
  ctx.ui.outro(
    `Once it's approved, run \`${POLL_HINT}\` to finish. The code expires at ${expiresAt(pending)}.`,
  );
}

async function pollForApproval(ctx: CommandContext, orgName: string | undefined): Promise<void> {
  const seconds = Number(ctx.argv.timeout ?? 60);
  const timeoutMs = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 60_000;
  const spin = ctx.ui.spinner();
  spin.start("Waiting for you to approve in the browser");
  let result: Awaited<ReturnType<typeof pollLogin>>;
  try {
    result = await pollLogin({ timeoutMs, orgName, onStatus: (m) => spin.message(m) });
  } catch (error) {
    spin.stop("Login failed");
    track("login finished", { status: "error", method: "oauth_poll" });
    throw error;
  }

  if (result.status === "logged_in") {
    const { session } = result;
    spin.stop(
      `Logged in as \`${session.userEmail ?? "you"}\`${session.orgName ? ` · \`${session.orgName}\`` : ""}`,
    );
    track("login finished", { status: "success", method: "oauth_poll" });
    if (ctx.json) return ctx.output.data({ status: "logged_in", ...sessionOutput(session) });
    await ensureSkillsCurrent(false, "login").catch(() => {});
    ctx.ui.outro("You're all set - run `superwall integrate` to set up your app.");
    return;
  }

  process.exitCode = 1;
  const { pending } = result;
  if (result.status === "needs_organization") {
    spin.stop("Approved");
    const message = `This account has no organization yet. Run \`${POLL_HINT} --org-name "<name>"\` to create one.`;
    if (ctx.json) return ctx.output.data({ status: "needs_organization", message });
    ctx.ui.warn(message);
    return;
  }
  spin.stop("Not approved yet");
  if (ctx.json) {
    return ctx.output.data({
      status: "pending",
      verification_url: pending.url,
      user_code: pending.userCode,
      expires_at: expiresAt(pending),
      next: POLL_HINT,
    });
  }
  ctx.ui.info(
    `Still waiting for approval · code \`${pending.userCode}\`\n${pending.url}\nRun \`${POLL_HINT}\` again. The code expires at ${expiresAt(pending)}.`,
  );
}

export const runLogout = defineCommand({
  name: "logout",
  output: "both",
  async run(ctx) {
    const s = loadSession();
    if (ctx.json) {
      clearSession();
      return ctx.output.data({
        loggedOut: Boolean(s),
        account: s ? sessionOutput(s) : null,
      });
    }
    if (!s) return void ctx.ui.error("You aren't logged in yet.");
    if (ctx.interactive) {
      const ok = await ctx.ui.confirm({
        message: `Log out of Superwall${s.userEmail ? ` (\`${s.userEmail}\`)` : ""}?`,
      });
      if (!ok) return void ctx.ui.outro("Staying logged in.");
    }
    clearSession();
    ctx.ui.success(`Logged out${s.userEmail ? ` (${s.userEmail})` : ""}.`);
  },
});

export const runWhoami = defineCommand({
  name: "whoami",
  output: "both",
  run(ctx) {
    const s = loadSession();
    if (!s) {
      if (ctx.json) return ctx.output.data({ authenticated: false });
      ctx.ui.error("You aren't logged in yet. Run `superwall login` to sign in.");
      return;
    }
    if (ctx.json) return ctx.output.data(sessionOutput(s));
    const credential = s.apiKey
      ? `API key sk_…${s.apiKey.slice(-4)}`
      : s.accessToken
        ? "OAuth session"
        : " - ";
    ctx.ui.list({
      items: [
        {
          label: s.userEmail ?? "Logged in",
          meta: s.orgName ? `· ${s.orgName}` : undefined,
          children: [{ label: credential, meta: effectiveHost(s) }],
        },
      ],
    });
  },
});

function effectiveHost(session: Session): string {
  return process.env.SUPERWALL_API_HOST ?? session.host ?? API_HOST();
}

function sessionOutput(session: Session): Record<string, unknown> {
  return {
    authenticated: true,
    user: { email: session.userEmail ?? null },
    organization: {
      id: session.orgId ?? null,
      name: session.orgName ?? null,
      count: session.orgCount ?? 1,
    },
    credential: {
      type: session.apiKey ? "api_key" : session.accessToken ? "oauth" : "unknown",
    },
    host: effectiveHost(session),
  };
}
