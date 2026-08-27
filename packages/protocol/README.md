<p align="center">
  <a href="https://superwall.com/">
    <img src="https://user-images.githubusercontent.com/3296904/158817914-144c66d0-572d-43a4-9d47-d7d0b711c6d7.png" alt="Superwall" height="100" />
  </a>
</p>

<h1 align="center">@superwall/protocol</h1>

<p align="center">
  The message contract between the native Superwall SDKs and a paywall
  running in their webview. Everything above this package is replaceable;
  this is the wire.
</p>

## Install

```bash
npm install @superwall/protocol
```

You will not usually install this directly:
[`@superwall/runtime`](https://www.npmjs.com/package/@superwall/runtime) and
the [`superwall`](https://www.npmjs.com/package/superwall) framework depend
on it. Reach for it alone to validate or replay SDK messages, or to build a
transport of your own.

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

## Develop

This package lives in the [`superwall/superwall`](https://github.com/superwall/superwall)
monorepo. **Read [AGENTS.md](https://github.com/superwall/superwall/blob/main/AGENTS.md)
first** - the conventions in it are decided, not suggested.

```bash
bun install
bun run test          # schema tests parse real messages and reject malformed
                      # ones; the deeper coverage is @superwall/runtime's
                      # fixture tests, which replay whole recorded sessions
bun run typecheck
```

There is no compile step in day-to-day development — `exports` point straight
at `src/`, so tests and consumers resolve the sources directly.

## License

[Functional Source License](https://github.com/superwall/superwall/blob/main/packages/superwall/LICENSE)
(FSL-1.1-ALv2): use it, modify it, embed it, ship it — anything except
building a competing product with it — and every release becomes Apache 2.0
two years after publication.
