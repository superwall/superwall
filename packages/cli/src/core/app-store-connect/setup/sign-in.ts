import type { CommandContext } from "@/program/command";
import {
  AppleError,
  type AppleSession,
  type AppleSessionOptions,
  type AppleTeam,
  type PendingVerification,
  type VerificationChallenge,
} from "@/core/app-store-connect/apple-web/session";
import { ENV_APPLE_ID, ENV_APPLE_PASSWORD } from "@/environment";
import { apiCall } from "@/ui/spinner";

export interface SignInFlags {
  appleId?: string;
  password?: string;
  code?: string;
  sms: boolean;
  phone?: string;
}

export interface SignInDeps {
  session: (options?: AppleSessionOptions) => AppleSession;
  credentials: () => { appleId?: string; password?: string };
  pending: {
    load: () => PendingVerification | undefined;
    save: (pending: PendingVerification) => void;
    clear: () => void;
  };
}

type SignInResult =
  | { status: "signed-in"; session: AppleSession }
  | { status: "verification-required"; challenge: VerificationChallenge };

const MAX_CODE_ATTEMPTS = 3;

function describeChallenge(challenge: VerificationChallenge): string {
  if (challenge.method === "device") return "Apple sent a code to your trusted devices.";
  const how = challenge.method === "voice" ? "is calling" : "texted a code to";
  return `Apple ${how} ${challenge.destination ?? "your trusted phone number"}.`;
}

async function startSession(
  ctx: CommandContext,
  deps: SignInDeps,
  flags: SignInFlags,
): Promise<{ session: AppleSession; needsCode: boolean; continued: boolean }> {
  const stored = deps.pending.load();
  const continuing =
    stored !== undefined &&
    (flags.code !== undefined || flags.sms || flags.phone !== undefined) &&
    (!flags.appleId || flags.appleId.toLowerCase() === stored.appleId.toLowerCase());
  if (continuing) {
    return { session: deps.session({ pending: stored }), needsCode: true, continued: true };
  }

  deps.pending.clear();
  const env = deps.credentials();
  let appleId = flags.appleId ?? env.appleId;
  let password = flags.password ?? env.password;
  if (ctx.interactive && (!appleId || !password)) {
    ctx.ui.note(
      "Your Apple password goes from this computer straight to Apple.\nSuperwall never receives it and it is not saved.",
      "Sign in to Apple",
    );
    if (!appleId) {
      const typed = await ctx.ui.text({
        message: "Apple Account email",
        placeholder: "you@example.com",
        validate: (value) => (value.trim() ? undefined : "Required"),
      });
      if (typed === null) throw new Error("Cancelled.");
      appleId = typed.trim();
    }
    if (!password) {
      const typed = await ctx.ui.text({
        message: "Apple Account password",
        secret: true,
        validate: (value) => (value ? undefined : "Required"),
      });
      if (typed === null) throw new Error("Cancelled.");
      password = typed;
    }
  }
  if (!appleId || !password) {
    throw new Error(
      [
        `Can't prompt for Apple sign-in here. Run this in a terminal, or supply the email and password with --apple-id/--apple-password (or ${ENV_APPLE_ID}/${ENV_APPLE_PASSWORD}).`,
        "If you are an agent, never ask for the password in chat. Instead:",
        `  1. Create a private file (chmod 600) holding two lines: \`${ENV_APPLE_ID}=\` and \`${ENV_APPLE_PASSWORD}=\`.`,
        "  2. Open it in the user's text editor and ask them to fill in both values and save.",
        "  3. Read each value into that environment variable without printing it, then run this again.",
        "  4. Delete the file when you are done.",
      ].join("\n"),
    );
  }
  const email = appleId;
  const secret = password;
  const session = deps.session();
  const outcome = await apiCall(ctx, "Signing in to Apple", () => session.signIn(email, secret));
  return { session, needsCode: outcome === "verification-required", continued: false };
}

async function signInToApple(
  ctx: CommandContext,
  deps: SignInDeps,
  flags: SignInFlags,
): Promise<SignInResult> {
  const { session, needsCode, continued } = await startSession(ctx, deps, flags);
  if (!needsCode) return { status: "signed-in", session };

  let code = flags.code;
  let challenge: VerificationChallenge = { method: "device", codeLength: 6 };
  if (!continued || !code) {
    challenge = await apiCall(ctx, "Requesting a verification code", () => {
      return session.requestCode({ sms: flags.sms, phone: flags.phone });
    });
  }

  for (let attempt = 1; ; attempt++) {
    if (!code) {
      if (!ctx.interactive) {
        deps.pending.save(session.pending());
        return { status: "verification-required", challenge };
      }
      ctx.ui.info(describeChallenge(challenge));
      const typed = await ctx.ui.text({
        message: "Verification code",
        placeholder: "0".repeat(challenge.codeLength),
        footer:
          challenge.method === "device"
            ? "No code? Type sms to get a text message instead."
            : undefined,
        validate: (value) => (value.trim() ? undefined : "Required"),
      });
      if (typed === null) throw new Error("Cancelled.");
      if (typed.trim().toLowerCase() === "sms") {
        challenge = await apiCall(ctx, "Requesting a text message", () => {
          return session.requestCode({ sms: true, phone: flags.phone });
        });
        continue;
      }
      code = typed.trim();
    }
    const submitted = code;
    try {
      await apiCall(ctx, "Verifying", () => session.submitCode(submitted));
      break;
    } catch (error) {
      if (!(error instanceof AppleError) || error.kind !== "verification") throw error;
      const message = `Apple didn't accept that code: ${error.message}`;
      if (!ctx.interactive) {
        deps.pending.save(session.pending());
        throw new Error(`${message}\nRun it again with --code <code>, or --sms to get a text.`);
      }
      if (attempt >= MAX_CODE_ATTEMPTS) throw new Error(message);
      ctx.ui.warn(message);
      code = undefined;
    }
  }
  deps.pending.clear();
  return { status: "signed-in", session };
}

export async function chooseTeam(
  ctx: CommandContext,
  session: AppleSession,
  requested: string | undefined,
): Promise<AppleTeam> {
  const teams = session.teams();
  if (requested) {
    const found = teams.find(
      (team) =>
        String(team.id) === requested || team.name.toLowerCase() === requested.toLowerCase(),
    );
    if (!found) {
      throw new Error(
        `This Apple Account isn't on team ${requested}. Its teams: ${teams.map((team) => `${team.id} (${team.name})`).join(", ")}.`,
      );
    }
    await session.selectTeam(found.id);
    return session.team();
  }
  if (teams.length <= 1) return session.team();
  if (!ctx.interactive) {
    throw new Error(
      `This Apple Account is on several teams: ${teams.map((team) => `${team.id} (${team.name})`).join(", ")}. Pass --team <id>.`,
    );
  }
  const picked = await ctx.ui.select({
    message: "Which Apple team?",
    options: teams.map((team) => ({ value: String(team.id), label: team.name })),
    initialValue: String(session.team().id),
  });
  if (picked === null) throw new Error("Cancelled.");
  await session.selectTeam(Number(picked));
  return session.team();
}

export async function signIn(
  ctx: CommandContext,
  deps: SignInDeps,
  command: string,
  flags: SignInFlags,
): Promise<AppleSession | undefined> {
  const signedIn = await signInToApple(ctx, deps, flags);
  if (signedIn.status === "signed-in") return signedIn.session;
  const next = `superwall ${command} --code <code>`;
  if (ctx.json) {
    ctx.output.data({
      status: "verification_required",
      method: signedIn.challenge.method,
      destination: signedIn.challenge.destination ?? null,
      next,
    });
  } else {
    ctx.ui.warn(
      `${describeChallenge(signedIn.challenge)}\nRun \`${next}\` with the same flags within 10 minutes to continue, or add --sms to get a text instead.`,
    );
  }
  ctx.fail();
  return undefined;
}
