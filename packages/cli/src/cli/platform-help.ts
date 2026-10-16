export const ASC_HELP = `An app's Apple keys: asc keys <action> --app <id>
  Each iOS app keeps two keys in Superwall:
    api_key       App Store Connect API key. Reads the app's products and
                  sets its server notification URL.
    purchase_key  In-App Purchase key. Reads transactions for one bundle ID.
  Without --app, keys list | set | rm act on the organization's keys, the
  ones the signed proxy uses. No command prints a private key, and none
  revokes a key at Apple.

  asc keys list --app <id>
    Which of the two keys the app has (key id, issuer id).
    Changes nothing. Exit 0.

  asc keys import [api_key | purchase_key] --app <id>
    Tries the keys your organization already has and saves the first one
    Apple confirms for this app's bundle ID. Both kinds when none is named.
    Never saves an unconfirmed key, never replaces a key the app has, and
    creates nothing at Apple.
    Exit 0 when every kind asked for is saved (imported or already_saved),
    1 when one is not_found.

  asc keys sources --app <id>
    Keys saved on the organization's other iOS apps, one row per distinct
    key. Changes nothing. Exit 0.

  asc keys copy <api_key | purchase_key> --app <id> --from <app id>
    Copies that app's key. Apple is asked whether it still works and
    whether its team owns this app. A key that no longer works is not
    saved. An api_key whose team shows no app with this bundle ID is not
    saved either (unconfirmed) unless --allow-unconfirmed is passed, which
    is a person's decision. A purchase_key Apple won't accept for this
    bundle ID is never saved.
    Exit 0 when saved, 1 when nothing was saved.

  asc keys create <api_key | purchase_key> --app <id>
    Signs in to Apple from this computer, creates one key named
    "Superwall" on the team that owns the app's bundle ID, and saves it on
    the app. Saving an api_key also gives the organization a key for that
    Apple team when it has none.
    When the app already has a key of that kind it does not sign in and
    creates nothing (already_saved, exit 0). --replace creates another and
    saves it; the old key stays valid at Apple.
    The bundle ID is checked on the signed-in team before anything is
    created. An app with no bundle ID gets that one, saved with the
    purchase_key; one with a different bundle ID than --bundle-id is
    refused before anything is created.
    The Apple password comes from a masked prompt, SUPERWALL_APPLE_PASSWORD
    or --apple-password. It goes only to Apple and is not saved. Without
    prompts, the first run stops for Apple's verification code
    (verification_required, exit 1): run it again with --code within 10
    minutes.
    Needs an Apple Account that is an Admin or the Account Holder, on a
    team with its agreements signed.
    Exit 0 when created or already_saved, 1 otherwise. A key Apple created
    that Superwall couldn't save is written to ./AuthKey_<id>.p8 or
    ./SubscriptionKey_<id>.p8, because Apple releases it only once.

  asc keys set [api_key | purchase_key] --app <id> --key-id <id>
               --issuer <id> --key-file <path.p8>
    Saves a key you hold as a file on the app (api_key when no kind is
    named). Apple is asked first: a key it rejects is not saved. Replaces
    the app's saved key of that kind. Exit 0 saved, 1 rejected.
    A purchase_key is for the app's bundle ID. When the app has none,
    --bundle-id <id> is saved on the app with the key, both or neither.
    A --bundle-id other than the app's is refused: change the app's first
    with apps bundle-id <id> --replace.

  asc keys rm <api_key | purchase_key> --app <id>
    Removes the app's saved key. Nothing is revoked at Apple and the
    organization's copy is kept. Exit 0.

  asc keys set --team <team id> --key-id <id> --issuer <id>
               --key-file <path.p8>
    Replaces the organization's key for that Apple team. Refused unless
    Apple confirms the new key belongs to the same team.

The server notification URL: asc notification-url <action> --app <id>
  Apple sends an app's purchase events to one URL per environment
  (production, sandbox).

  asc notification-url [get] --app <id>
    Prints this app's Superwall URL. Asks Apple nothing, changes nothing.
    Works with an API key. Exit 0.

  asc notification-url check --app <id>
    Asks Apple what it has, with the app's saved api_key, and says for
    production and sandbox whose URL it is:
      this_app       this app's Superwall URL, in either form Superwall has
                     issued
      superwall_app  another Superwall app's. Named, with its URL, when you
                     can read that app; otherwise its token reads REDACTED
      other          someone else's, such as RevenueCat or your own server
      none           Apple has no URL
    status is already_set, not_set, conflict, skipped (no api_key or no
    bundle ID saved) or failed (the message says why).
    Changes nothing. Exit 0 unless skipped or failed (1).

  asc notification-url set --app <id>
    Writes this app's Superwall URL into whichever environment is empty.
    Never replaces another server's or another Superwall app's URL: a
    conflict is reported and left alone (exit 1). To switch, a person clears
    it in App Store Connect, or forwards from that server to the URL above.
    Does not change the revenue provider unless --set-revenue-provider is
    passed. Receiving Apple's notifications and choosing which revenue
    source the dashboard counts are separate decisions.
    Exit 0 for set or already_set, 1 otherwise.

  check and set work with a \`superwall login\` session or an API key with
  applications:write.`;

export const SETUP_APPLE_HELP = `What it does
  One Apple sign-in, then for one iOS app: creates the App Store Connect
  API key and the In-App Purchase key the app does not already have, saves
  them on the app, and sets the server notification URL where Apple has
  none. It can also create the Superwall app from an App Store Connect
  app. Each step is one of the single commands in \`superwall asc --help\`.

Bundle ID
  An app with no bundle ID gets the App Store Connect app's: saved with the
  In-App Purchase key, both or neither, or on its own before the
  notification URL when that key isn't created. It says how many reported
  builds would run in test mode.

What it never does
  It never creates a second key of a kind the app already has (reported as
  already saved), never replaces a server notification URL another server
  holds, never revokes a key, never replaces an app's different bundle ID (it
  stops before anything is created and points at apps bundle-id --replace),
  and never changes the revenue provider (see
  \`superwall revenue-provider --help\`).

Sign-in
  The Apple password comes from a masked prompt, SUPERWALL_APPLE_PASSWORD
  or --apple-password. It goes only to Apple and is not saved. Without
  prompts, the first run stops for Apple's verification code
  (verification_required): run it again with --code within 10 minutes.

Exit codes
  0 when every step is done or skipped. 1 when a step failed or a
  verification code is needed. --json lists each step under steps and the
  failed ones under failed.`;

export const REVENUE_PROVIDER_HELP = `What it is
  An app can receive purchase events from its store (App Store Connect or
  Google Play, sent straight to Superwall) and from RevenueCat. Both keep
  arriving and being stored. The revenue provider only decides which of
  them every revenue figure in the dashboard counts:
    open_revenue  the store's own events
    revenue_cat   RevenueCat's events
  With none chosen, events from every source are counted.

  revenue-provider [get] --app <id>
    The provider, and how many events each source sent in the last 30
    days when the API reports it. Changes nothing. Exit 0.

  revenue-provider set <open_revenue | revenue_cat> --app <id>
    Changes which source is counted. It changes no key, no URL and no
    stored event, and it can be changed back. Setting the value it already
    has does nothing (exit 0).
    A change is confirmed first: a prompt in a terminal, --yes outside
    one. Without --yes outside a terminal it changes nothing, says what
    would change, and exits 1. --dry-run does the same and exits 0.
    Works for an app on any platform.`;


export const APPS_HELP = `An app's bundle ID: apps bundle-id [value] --app <id>
  The bundle ID (iOS) or package name (Android) decides which builds the SDK
  treats as this app. A build whose ID is neither it nor starts with it
  followed by a dot runs in test mode.

  apps bundle-id --app <id>
    The ID the app has, and the ones its SDK reported in the last 30 days,
    each with production and sandbox devices, when it was last seen and its
    most common country. Changes nothing. Exit 0.

  apps bundle-id <value> --app <id>
    Saves it. Superwall checks the format for the app's platform. When the
    SDK reported production devices on other IDs that neither equal <value>
    nor start with "<value>.", it says how many would run in test mode and
    asks first: a prompt in a terminal, --yes outside one. Without --yes
    outside a terminal it changes nothing and exits 1.
    An app that already has a different ID keeps it unless --replace is
    passed, and replacing also asks first. --app-store-id saves the App
    Store ID too, only when the app has none. Saving the ID it already has
    does nothing. --dry-run says what would change.
    Never guesses an ID and never writes one the person didn't give.
    Exit 0 when saved or unchanged, 1 otherwise.`
