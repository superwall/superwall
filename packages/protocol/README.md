# `@superwall/protocol`

The message contract between the native Superwall SDKs and a paywall running
in their webview. Everything above this package (runtime, react, framework)
is replaceable; this is the wire.

## What's here

- **`messages/`** — zod schemas for both directions:
  - _incoming_ (SDK → paywall): `template_variables`, `products`,
    `experiment`, `paywall_open`, `freeTrial_start`, `transaction_complete`,
    `transaction_abandon`, `permission_result`, `callback_result`, editor
    focus/blur events, … united as `IncomingMessageSchema`.
  - _outgoing_ (paywall → SDK): `ping`, `close`, `restore`, `open_url`,
    `purchase`, `custom_placement`, `request_permission`,
    `schedule_notification`, … united as `OutgoingMessageSchema`.
- **`transport/`** — `ITransport` and the concrete transports: WebKit message
  handlers (iOS), the Android bridge, and the editor iframe transport used by
  previews. `buildTransport(kind)` selects one.
- **`initializationParams.ts`** — `TransportKind`, `Platform`, and the query
  params the SDK passes when loading a paywall.
- **`sub.ts` / `tags.ts` / `pageStyles.ts`** — substitution, tag, and page
  style schemas shared by both directions.

## Compatibility rules

Old app binaries with old native SDKs load new paywall bundles indefinitely.
Therefore:

- **Additive changes only** — new message types, new optional fields.
- Never rename or remove an `event_name`, a field, or an enum value.
- Never make an optional field required.
- Every new message type ships with accept and reject test cases.

## Tests

`bun run test` — schema tests parse representative real messages and assert
rejection of malformed ones. The deeper contract coverage lives in
`@superwall/runtime`'s fixture tests, which drive full recorded message
sequences through the session.
