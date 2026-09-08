<p align="center">
  <a href="https://superwall.com/">
    <img src="https://user-images.githubusercontent.com/3296904/158817914-144c66d0-572d-43a4-9d47-d7d0b711c6d7.png" alt="Superwall" height="100" />
  </a>
</p>

<h1 align="center">@superwall/protocol</h1>

<p align="center">
  The message contract between a Superwall host (native SDK, web host,
  editor, studio) and a paywall running in its webview. Everything above
  this package is replaceable; this is the wire.
</p>

## Install

```bash
npm install @superwall/protocol
```

You will not usually install this directly:
[`@superwall/runtime`](https://www.npmjs.com/package/@superwall/runtime),
[`@superwall/host`](https://www.npmjs.com/package/@superwall/host) and the
[`superwall`](https://www.npmjs.com/package/superwall) framework depend on
it. Reach for it alone to validate or replay SDK messages, or to build a
transport of your own.

## What's here

| File                      | Owns                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `messages/incoming.ts`    | `IncomingMessageSchema`, host → paywall, and one `TIncomingMessage…` type per message                                          |
| `messages/outgoing.ts`    | `OutgoingMessageSchema`, paywall → host                                                                                        |
| `messages/permissions.ts` | The permission types a paywall can request and the statuses a host answers with                                                |
| `transport/`              | `ITransport`, the envelope (`wrap`/`unwrap`, `MessageDirection`), and the three transports `buildTransport(kind)` selects      |
| `transport/params.ts`     | `TransportKind`, `Platform`, and the query params a host loads a paywall with (`?transport=`, `?platform=`, `?sdkVersion=`)    |
| `test/fixtures/host/`     | Literal message sequences copied from the production hosts, the contract every host and runtime in this repo is tested against |

The schemas are a copy of paywall.js's `paywall-js/messages`, kept in step
with it. Three differences are deliberate: `freeTrial_start.trial_end_date`
also accepts the epoch in milliseconds iOS actually sends;
`back_button_input` carries no payload, which is what Android sends; and the
editor's substitution and page-style payloads (`ping.substitutions`,
`page_styles`, `template_substitutions`) are opaque arrays, because a
framework paywall sends none and ignores what an editor sends.

## Host → paywall

Every native message also carries `paywall_id` and `paywall_identifier`;
the schemas strip what they do not declare.

| `event_name`                                                                                                                                          | Fields                                                          | Sent by                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------- |
| `template_variables`                                                                                                                                  | `variables` (`device`, `user`, `params`, `products` + v3 slots) | every host, in reply to `ping`              |
| `products`                                                                                                                                            | `products[]` of `{ product, productId }`                        | every host, in reply to `ping`              |
| `experiment`                                                                                                                                          | `experimentId`, `variantId`, `campaignId`                       | every host, in reply to `ping`              |
| `template_substitutions_prefix`                                                                                                                       | `prefix`: `"freeTrial"` or `null`                               | every host, in reply to `ping`              |
| `paywall_open`                                                                                                                                        | `paywall_id`, `paywall_identifier`                              | every host, last in the reply to `ping`     |
| `paywall_close`                                                                                                                                       | optional ids                                                    | iOS, Android                                |
| `transaction_start`, `transaction_complete`, `transaction_abandon`                                                                                    | optional `product_identifier`, `product`                        | iOS, Android, web host                      |
| `transaction_fail`, `transaction_timeout`, `transaction_restore`                                                                                      | optional `product_identifier`, `product`                        | iOS                                         |
| `freeTrial_start`                                                                                                                                     | optional `product_identifier`, `trial_end_date` (ms or ISO)     | iOS, Android                                |
| `restore_start`, `restore_complete`                                                                                                                   | none                                                            | iOS                                         |
| `restore_fail`                                                                                                                                        | none                                                            | iOS, Android                                |
| `permission_result`                                                                                                                                   | `permission_type`, `request_id`, `status`                       | iOS, Android                                |
| `callback_result`                                                                                                                                     | `request_id`, `name`, `status`, optional `data`                 | iOS, Android                                |
| `event_tracking_behavior`                                                                                                                             | `behavior`: `all`, `superwallOnly`, `none`                      | iOS, Android                                |
| `back_button_input`                                                                                                                                   | none                                                            | Android                                     |
| `game_controller_input`                                                                                                                               | `controller_element`, `directional` + `x`/`y` or `value`        | iOS                                         |
| `redeem_discount`                                                                                                                                     | `code`                                                          | hosts embedding web checkout                |
| `template_substitutions`, `page_styles`, `template_json`, `focus_*`, `unfocus_*`, `substitution_editor_*`, `application_settings`, `paywall_settings` | editor state                                                    | the visual editor; the runtime ignores them |

## Paywall → host

| `event_name`                                                           | Fields                                                                                    |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `ping`                                                                 | `substitutions`, `page_styles`, optional `version`, `products`, `coordinates`, `fonts`    |
| `close`, `restore`                                                     | none                                                                                      |
| `purchase`                                                             | `product` (reference), optional `product_identifier`, `should_dismiss`                    |
| `open_url`                                                             | `url`, optional `browser_type: "payment_sheet"`                                           |
| `open_url_external`, `open_payment_sheet`                              | `url`                                                                                     |
| `open_deep_link`                                                       | `link`                                                                                    |
| `custom`                                                               | `data`                                                                                    |
| `custom_placement`                                                     | `name`, `params`                                                                          |
| `user_attribute_updated`                                               | `attributes[]` of `{ key, value }`                                                        |
| `request_store_review`                                                 | `review_type`: `in-app`, `external`                                                       |
| `haptic_feedback`                                                      | `haptic_type`                                                                             |
| `request_permission`                                                   | `permission_type`, `request_id`                                                           |
| `request_callback`                                                     | `request_id`, `name`, `behavior`, optional `variables`                                    |
| `schedule_notification`                                                | `id`, `type: "TRIAL_STARTED"`, `title`, optional `subtitle`, `body`, `delay` (ms)         |
| `page_view`                                                            | `type`, `page_node_id`, `page_name`, `navigation_node_id`, `flow_position`, previous page |
| `initiate_web_checkout`, `stripe_checkout_*`, `post_checkout_complete` | web checkout lifecycle, keyed by `checkout_context_id` and `product_identifier`           |
| `discount_redemption_result`                                           | `code`, `valid`, optional `reason`, `appliedProductCount`                                 |
| `var_click`, `page_styles`, `has_set_dom`                              | editor state                                                                              |

## Transports

`buildTransport(kind)` picks how messages reach the host: WebKit message
handlers on iOS (`window.webkit.messageHandlers.paywallMessageHandler`,
queueing into `window.app.messages` until the host installs one), the
Android `SWAndroid` interface, or `postMessage` to the parent window for
the editor and the studio. Every host delivers messages to the paywall
through `window.paywall.accept64(base64)` or `accept(messages)`; the
transport's `accept` fans them out to listeners once `startListening` has
been called.

The editor transport posts to `window.parent` with origin `*` and accepts any
origin, the same as paywall.js; a paywall only ever runs in a page its host
loaded, so the host is trusted by construction.

Set `localStorage.SW_DEBUG_TRANSPORT = "true"` to log every message.

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
bun run test          # every message has accept and reject cases; the host fixtures replay real sequences
bun run typecheck
```

There is no compile step in day-to-day development — `exports` point straight
at `src/`, so tests and consumers resolve the sources directly.

## License

[Functional Source License](https://github.com/superwall/superwall/blob/main/packages/superwall/LICENSE)
(FSL-1.1-ALv2): use it, modify it, embed it, ship it — anything except
building a competing product with it — and every release becomes Apache 2.0
two years after publication.
