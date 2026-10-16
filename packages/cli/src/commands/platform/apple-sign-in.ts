import type { CommandContext } from "@/command";
import { ENV_APPLE_ID, ENV_APPLE_PASSWORD } from "@/environment";
import {
  AppleError,
  type AppleSession,
  type AppleSessionOptions,
  type PendingVerification,
  type VerificationChallenge,
} from "@/core/apple/session";
import { apiCall } from "@/commands/api-output";

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

export type SignInResult =
  | { status: "signed-in"; session: AppleSession }
  | { status: "verification-required"; challenge: VerificationChallenge };

const MAX_CODE_ATTEMPTS = 3;

export function describeChallenge(challenge: VerificationChallenge): string {
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

export async function signInToApple(
  ctx: CommandContext,
  deps: SignInDeps,
  flags: SignInFlags,
): Promise<SignInResult> {
  const { session, needsCode, continued } = await startSession(ctx, deps, flags);
  if (!needsCode) return { status: "signed-in", session };

  let code = flags.code;
  let challenge: VerificationChallenge = { method: "device", codeLength: 6 };
  if (!continued || !code) {
    challenge = await apiCall(ctx, "Requesting a verification code", () =>
      session.requestCode({ sms: flags.sms, phone: flags.phone }),
    );
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
        challenge = await apiCall(ctx, "Requesting a text message", () =>
          session.requestCode({ sms: true, phone: flags.phone }),
        );
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
