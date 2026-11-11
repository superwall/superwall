export class NotLoggedInError extends Error {
  constructor() {
    super("You aren't logged in. Run `superwall login` first.");
    this.name = "NotLoggedInError";
  }
}

export class LoginUnreachableError extends Error {
  readonly timedOut: boolean;

  constructor(endpoint: string, cause: unknown, timeoutMs?: number) {
    const origin = URL.canParse(endpoint) ? new URL(endpoint).origin : endpoint;
    super(
      timeoutMs === undefined
        ? `Couldn't reach the Superwall login service at ${origin} to refresh your session.\n  Check your network or proxy, then try again.`
        : `The Superwall login service at ${origin} didn't answer within ${timeoutMs / 1000}s, so your session wasn't refreshed.\n  Try again.`,
    );
    this.name = "LoginUnreachableError";
    this.cause = cause;
    this.timedOut = timeoutMs !== undefined;
  }
}
