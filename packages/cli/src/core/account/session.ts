import type { CommandContext } from "@/program/command";
import {
  readSession,
  removeSession,
  serializeSession,
  resolveApiHost,
  sessionOrgName,
} from "@/core/account/storage";

export function runWhoami(ctx: CommandContext<"none">): void | Promise<void> {
  const s = readSession();
  if (!s) {
    if (ctx.json) return ctx.output.data({ authenticated: false });
    ctx.ui.error("You aren't logged in yet. Run `superwall login` to sign in.");
    return;
  }
  if (ctx.json) return ctx.output.data(serializeSession(s));
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
        children: [{ label: credential, meta: resolveApiHost(s) }],
      },
    ],
  });
}

export async function runLogout(ctx: CommandContext<"none">): Promise<void> {
  const s = readSession();
  if (ctx.json) {
    removeSession();
    return ctx.output.data({
      loggedOut: Boolean(s),
      account: s ? serializeSession(s) : null,
    });
  }
  if (!s) return void ctx.ui.error("You aren't logged in yet.");
  if (ctx.interactive) {
    const ok = await ctx.ui.confirm({
      message: `Log out of Superwall${s.userEmail ? ` (\`${s.userEmail}\`)` : ""}?`,
    });
    if (!ok) return void ctx.ui.outro("Staying logged in.");
  }
  removeSession();
  ctx.ui.success(`Logged out${s.userEmail ? ` (${s.userEmail})` : ""}.`);
}
