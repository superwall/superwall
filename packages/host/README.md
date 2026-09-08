<p align="center">
  <a href="https://superwall.com/">
    <img src="https://user-images.githubusercontent.com/3296904/158817914-144c66d0-572d-43a4-9d47-d7d0b711c6d7.png" alt="Superwall" height="100" />
  </a>
</p>

<h1 align="center">@superwall/host</h1>

<p align="center">
  A paywall host. It sits where the native SDK sits, answers the paywall's
  <code>ping</code> the way the SDKs do, and replies to the paywall's events
  with the SDK's messages. The studio, <code>superwall dev</code>, the
  dashboard and the runtime's tests all host paywalls through it.
</p>

## What this is not

It is not a paywall, and it never runs inside one. It is not a mock: every
message it sends is a message a real host sends, in the order a real host
sends it. It is not React.

## Install

```bash
npm install @superwall/host
```

## Hosting an iframe

```ts
import { createWindowHost, defaultDevice, DEFAULT_USER, DEFAULT_PARAMS } from "@superwall/host";

const iframe = document.querySelector("iframe");
iframe.src = `${snapshotUrl}?transport=editor`;

const { host, detach } = createWindowHost({
  target: iframe.contentWindow,
  state: {
    paywallId: "123",
    paywallIdentifier: "my_paywall",
    device: defaultDevice(),
    user: DEFAULT_USER,
    params: DEFAULT_PARAMS,
    products: [{ reference: "primary", productId: "com.app.annual", variables: { price: "$89.99" } }],
  },
  delegate: {
    event: (message) => log(message),
    purchase: async (product) => (await ask(`Purchase ${product.reference}?`)) ? "completed" : "abandoned",
    restore: async () => ((await ask("Restore?")) ? "restored" : "failed"),
    close: () => toast("closed"),
    openUrl: (url, kind) => toast(`${kind}: ${url}`),
    custom: (data) => toast(data),
    customPlacement: (name) => toast(name),
    permission: async (type) => ((await ask(`Grant ${type}?`)) ? "granted" : "denied"),
    callback: async () => ({ status: "success" }),
  },
});

host.update({ device: { interfaceStyle: "Light" } });
```

The paywall pings on its own once it loads. The host answers with one
envelope, in this order: `template_variables`, `experiment`, `products`,
`template_substitutions_prefix`, `paywall_open`. That is the web host's order
(`web-paywalls/src/controller/index.ts`); the iOS SDK sends the same set.

`update(patch)` merges into the state and re-sends only what changed:
`template_variables` for device, user, params or product variables;
`products` when a product id changed; `experiment` when it changed;
`template_substitutions_prefix` when introductory offer eligibility flipped. That is the
visual editor's granularity.

## Replies

| Paywall sends                                                                   | Delegate decides                     | Host replies                                                                                                                                                            |
| ------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `purchase`                                                                      | `completed` / `abandoned` / `failed` | `transaction_start` first; then `transaction_complete` (+ `freeTrial_start` when eligible and the product has trial days), `transaction_abandon`, or `transaction_fail` |
| `restore`                                                                       | `restored` / `failed`                | `restore_start`; then `transaction_restore` + `restore_complete`, or `restore_fail`                                                                                     |
| `close`                                                                         | —                                    | `paywall_close`                                                                                                                                                         |
| `request_permission`                                                            | a permission status                  | `permission_result`                                                                                                                                                     |
| `request_callback`                                                              | `{ status, data? }`                  | `callback_result`                                                                                                                                                       |
| `user_attribute_updated`                                                        | —                                    | nothing; merged into the host's user for the next `template_variables`                                                                                                  |
| `open_url`, `open_url_external`, `open_deep_link`, `custom`, `custom_placement` | called                               | nothing                                                                                                                                                                 |
| anything else                                                                   | `event()` only                       | nothing                                                                                                                                                                 |

Every message the paywall sends reaches `delegate.event` first.

## In-process transport

`createHostTransport({ state, delegate })` returns an `ITransport` plus the
host behind it. Hand the transport to a runtime session and the session is
hosted exactly as it would be by an iframe host, with no window involved.
Replies are delivered on a microtask, or after `latencyMs` when set.

## Defaults

`@superwall/host/defaults` carries the values a host falls back to when it
has no live data: the API's default device sample (`UserDataService.ts` in
the dashboard repo, the `device-properties-sample` endpoint's answer for an
app with no traffic) plus its derived time fields, the default user sample,
the default placement params, and the visual editor's example product
(`paywall-preview-variables.ts` `FALLBACK_PRODUCT_EXAMPLE`). `withoutTrial`
strips every trial key, which is what the editor does for a slot it has no
product for. Change these only when their sources change.

## Layout

```
src/
  state.ts        HostState: paywall identity, device, user, params, products,
                  introductory offer eligibility, experiment; merge helpers
  messages/       one builder per to_paywall message, grouped by concern:
                  ping.ts (the burst), transaction.ts, restore.ts, results.ts
  delegate/       HostDelegate (types.ts) and the recording delegate for tests
  host/           createPaywallHost (index.ts) routes paywall events; flows.ts
                  holds the purchase, restore, permission and callback flows
  adapters/       window.ts (iframe over postMessage), transport.ts (in-process
                  ITransport for sessions and tests)
  defaults/       device.ts, user.ts, params.ts, product.ts: values copied from
                  the dashboard, see Defaults above
```

Sources of every default (dashboard repo unless noted), so a diff is one grep:

| Constant                                    | Copied from                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `DEFAULT_DEVICE`, `derivedDeviceProperties` | `packages/api/src/v2/repository/users/UserDataService.ts` (`EXAMPLE_DEVICE_EVENT`, `derivedDeviceProperties`)       |
| `DEFAULT_USER`                              | same file, `EXAMPLE_USER_PROPERTIES`                                                                                |
| `DEFAULT_PARAMS`                            | this repo, `packages/superwall/src/preview/project.ts` `SAMPLE_DEFAULTS.params`, what `superwall dev` always showed |
| `EXAMPLE_PRODUCT_VARIABLES`, `withoutTrial` | `apps/web2/src/lib/paywall-preview-variables.ts` (`FALLBACK_PRODUCT_EXAMPLE`, `FALLBACK_PRODUCT_EXAMPLE_NO_TRIAL`)  |

## Develop

Lives in the [`superwall/superwall`](https://github.com/superwall/superwall)
monorepo; read its AGENTS.md first.

```bash
bun run test
bun run typecheck
```

The message builders are tested against the fixtures in
`@superwall/protocol`'s `test/fixtures/host/`, which are literal captures from
the production hosts.

## License

[Functional Source License](https://github.com/superwall/superwall/blob/main/packages/superwall/LICENSE)
(FSL-1.1-ALv2).
