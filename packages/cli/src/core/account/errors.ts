export class NotLoggedInError extends Error {
  constructor() {
    super("You aren't logged in. Run `superwall login` first.");
    this.name = "NotLoggedInError";
  }
}
