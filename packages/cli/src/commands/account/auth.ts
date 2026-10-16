import { defineCommand } from "@/command";
import { API_HOST } from "@/environment";
import { ensureSkillsCurrent } from "@/core/agent/skills";
import { onboardingHooks } from "@/core/account/onboarding";
import { track } from "@/core/telemetry";
import { BROWSER_UNAVAILABLE } from "@/core/auth/browser";
import { loginWithApiKey, performLogin } from "@/core/auth/login";
import { clearSession, loadSession, sessionOrgName, type Session } from "@/core/auth/storage";
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

    if (!ctx.interactive)
      throw new Error(
        "Browser login requires an interactive terminal. Use `superwall login --api-key <key>`.",
      );

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
        `Logged in as \`${session.userEmail ?? "you"}\`${sessionOrgName(session) ? ` · \`${sessionOrgName(session)}\`` : ""}`,
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
          meta: sessionOrgName(s) ? `· ${sessionOrgName(s)}` : undefined,
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
    credential: {
      type: session.apiKey ? "api_key" : session.accessToken ? "oauth" : "unknown",
    },
    host: effectiveHost(session),
  };
}
