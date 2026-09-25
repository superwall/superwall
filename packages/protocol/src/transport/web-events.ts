import type { TOutgoingMessage } from "../messages";
import { decodeBase64Utf8 } from "./base64";
import { createTransportLogger } from "./shared";

const log = createTransportLogger("WebEvents");

type Slice = Record<string, unknown>;

type UserId = { type: "appUserId"; appUserId: string } | { type: "aliasId"; aliasId: string };

export type WebSdkCollector = {
  url: string;
  headers: Record<string, string>;
  placementEventId: string;
  identity: { userId: UserId };
  userAttributes: Slice;
  deviceAttributes: Slice;
  experimentSlice: Slice;
  paywallSlice: Slice;
  productSlice: Record<string, Slice>;
  presentmentSlice: Slice;
  placementParamsSlice: Slice;
};

export type WebSdkEventsInit = {
  collector: WebSdkCollector;
  clientSurface?: string;
  hostOrigin?: string;
  sdkVersion?: string;
  managedPayments?: boolean;
  paywallManagedPaymentsOverride?: string | null;
};

type CollectorEvent = { event_id?: string; event_name: string; parameters: Slice };

const isRecord = (value: unknown): value is Slice =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const recordOf = (value: unknown): Slice => (isRecord(value) ? value : {});

const stringOf = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const userIdOf = (value: unknown): UserId | undefined => {
  if (!isRecord(value)) return undefined;
  if (value.type === "appUserId" && typeof value.appUserId === "string") {
    return { type: "appUserId", appUserId: value.appUserId };
  }
  if (value.type === "aliasId" && typeof value.aliasId === "string") {
    return { type: "aliasId", aliasId: value.aliasId };
  }
  return undefined;
};

const collectorOf = (value: unknown): WebSdkCollector | undefined => {
  if (!isRecord(value)) return undefined;
  const url = stringOf(value.url);
  const userId = userIdOf(recordOf(value.identity).userId);
  if (!url || !userId) return undefined;
  const headers = Object.fromEntries(
    Object.entries(recordOf(value.headers)).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  return {
    url,
    headers,
    placementEventId: stringOf(value.placementEventId) ?? crypto.randomUUID(),
    identity: { userId },
    userAttributes: recordOf(value.userAttributes),
    deviceAttributes: recordOf(value.deviceAttributes),
    experimentSlice: recordOf(value.experimentSlice),
    paywallSlice: recordOf(value.paywallSlice),
    productSlice: recordOf(value.productSlice) as Record<string, Slice>,
    presentmentSlice: recordOf(value.presentmentSlice),
    placementParamsSlice: recordOf(value.placementParamsSlice),
  };
};

export const webSdkEventsInit = (
  hash: string = window.location.hash,
  search: string = window.location.search,
): WebSdkEventsInit | null => {
  if (!hash.startsWith("#init=")) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(decodeBase64Utf8(hash.slice("#init=".length)));
  } catch {
    return null;
  }
  if (!isRecord(payload)) return null;
  const collector = collectorOf(payload.collector);
  if (!collector) return null;
  const checkoutContext = recordOf(payload.checkoutContext);
  const params = new URLSearchParams(search);
  const clientSurface = stringOf(payload.clientSurface) ?? stringOf(params.get("client_surface"));
  const hostOrigin = stringOf(payload.hostOrigin) ?? stringOf(params.get("host_origin"));
  const sdkVersion = stringOf(params.get("sdk_version"));
  return {
    collector,
    ...(clientSurface ? { clientSurface } : {}),
    ...(hostOrigin ? { hostOrigin } : {}),
    ...(sdkVersion ? { sdkVersion } : {}),
    managedPayments: checkoutContext.managedPayments === true,
    paywallManagedPaymentsOverride:
      stringOf(checkoutContext.paywallManagedPaymentsOverride) ?? null,
  };
};

const connectionType = (): string => {
  try {
    const connection = (navigator as Navigator & { connection?: { type?: string } }).connection;
    return connection?.type || "unknown";
  } catch {
    return "unknown";
  }
};

const deviceProperties = () => {
  const now = new Date();
  const localDate = now.toISOString().slice(0, 10);
  const localTime = now.toTimeString().slice(0, 8);
  return {
    interfaceStyle:
      typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light",
    isLowPowerModeEnabled: false,
    radioType: connectionType(),
    localDate,
    localTime,
    localDateTime: `${localDate}T${localTime}`,
  };
};

const withoutStorePrefix = (identifier: string) => identifier.replace(/^[^|]+\|/, "");

export class WebSdkEvents {
  private readonly init: WebSdkEventsInit;
  private readonly collector: WebSdkCollector;
  private readonly presentationId = crypto.randomUUID();
  private readonly prefetched = new Set<string>();
  private headers: Record<string, string>;
  private userAttributes: Slice;
  private opened = false;

  constructor(init: WebSdkEventsInit) {
    this.init = init;
    this.collector = init.collector;
    this.userAttributes = { ...init.collector.userAttributes };
    const { userId } = init.collector.identity;
    const { "x-alias-id": _aliasId, ...rest } = init.collector.headers;
    this.headers = {
      ...rest,
      "x-app-user-id": userId.type === "appUserId" ? userId.appUserId : userId.aliasId,
      ...(userId.type === "appUserId" ? { "x-alias-id": userId.appUserId } : {}),
    };
  }

  static fromLocation(): WebSdkEvents | null {
    if (typeof window === "undefined") return null;
    const init = webSdkEventsInit();
    return init ? new WebSdkEvents(init) : null;
  }

  observe(message: TOutgoingMessage): void {
    switch (message.event_name) {
      case "ping":
        if (this.opened) return;
        this.opened = true;
        void this.trackOpen();
        return;
      case "close":
        void this.publish([{ event_name: "paywall_close", parameters: this.lifecycleSlices() }]);
        return;
      case "user_attribute_updated":
        this.userAttributes = {
          ...this.userAttributes,
          ...Object.fromEntries(message.attributes.map(({ key, value }) => [key, value])),
        };
        void this.publish([
          { event_name: "user_attributes", parameters: { ...this.userAttributes } },
        ]);
        return;
      case "page_view":
        void this.publish([
          {
            event_name: "paywall_page_view",
            parameters: {
              ...this.lifecycleSlices(),
              $page_node_id: message.page_node_id,
              $flow_position: message.flow_position,
              $page_name: message.page_name,
              $navigation_node_id: message.navigation_node_id,
              $navigation_type: message.type,
              ...(message.previous_page_node_id == null
                ? {}
                : { $previous_page_node_id: message.previous_page_node_id }),
              ...(message.previous_flow_position == null
                ? {}
                : { $previous_flow_position: message.previous_flow_position }),
              ...(message.time_on_previous_page_ms == null
                ? {}
                : { $time_on_previous_page_ms: message.time_on_previous_page_ms }),
            },
          },
        ]);
        return;
      case "stripe_checkout_prefetch":
        this.prefetched.add(message.checkout_context_id);
        void this.trackStripeCheckout("prefetch", message);
        return;
      case "stripe_checkout_start":
        void this.trackStripeCheckout("start", message);
        if (this.prefetched.delete(message.checkout_context_id)) {
          void this.trackTransactionStart(message.product_identifier);
        }
        return;
      case "stripe_checkout_submit":
        void this.trackStripeCheckout("submit", message);
        return;
      case "stripe_checkout_fail":
        void this.trackStripeCheckout("fail", message);
        return;
      case "stripe_checkout_abandon":
        void this.trackStripeCheckout("abandon", message);
        void this.publish([
          {
            event_name: "transaction_abandon",
            parameters: this.transactionParameters(message.product_identifier),
          },
        ]);
        return;
      case "stripe_checkout_complete":
        void this.trackStripeCheckout("complete", message);
        return;
      default:
        return;
    }
  }

  private lifecycleSlices(): Slice {
    return {
      ...this.collector.experimentSlice,
      ...this.collector.paywallSlice,
      ...this.collector.presentmentSlice,
    };
  }

  private trackOpen() {
    const device = deviceProperties();
    this.headers = {
      ...this.headers,
      "x-device-interface-style": device.interfaceStyle,
      "x-radio-type": device.radioType,
      "x-low-power-mode": String(device.isLowPowerModeEnabled),
    };
    Object.assign(this.collector.deviceAttributes, {
      $interfaceStyle: device.interfaceStyle,
      $isLowPowerModeEnabled: device.isLowPowerModeEnabled,
      $radioType: device.radioType,
      $localDate: device.localDate,
      $localTime: device.localTime,
      $localDateTime: device.localDateTime,
    });

    const placement = this.collector.presentmentSlice.$presented_by_event_name;
    return this.publish([
      {
        event_id: this.collector.placementEventId,
        event_name: String(placement ?? ""),
        parameters: { ...recordOf(this.collector.placementParamsSlice.$placement_params) },
      },
      {
        event_name: "trigger_fire",
        parameters: {
          ...this.collector.experimentSlice,
          $result: "present",
          $is_standard_event: true,
          $paywall_identifier: this.collector.paywallSlice.$paywall_identifier,
          $trigger_name: placement,
        },
      },
      {
        event_name: "paywall_open",
        parameters: {
          ...this.collector.experimentSlice,
          ...this.collector.presentmentSlice,
          ...this.collector.paywallSlice,
        },
      },
      { event_name: "user_attributes", parameters: { ...this.userAttributes } },
      { event_name: "device_attributes", parameters: { ...this.collector.deviceAttributes } },
    ]);
  }

  private trackStripeCheckout(
    state: "prefetch" | "start" | "submit" | "complete" | "fail" | "abandon",
    message: { checkout_context_id: string; product_identifier: string },
  ) {
    return this.publish([
      {
        event_name: `stripeCheckout_${state}`,
        parameters: {
          ...this.lifecycleSlices(),
          $store: "STRIPE",
          $product_identifier: message.product_identifier,
          $checkout_context_id: message.checkout_context_id,
        },
      },
    ]);
  }

  private trackTransactionStart(productIdentifier: string) {
    const storePrefixed = productIdentifier.includes("|")
      ? productIdentifier
      : `stripe|${productIdentifier}`;
    return this.publish([
      {
        event_name: "transaction_start",
        parameters: this.transactionParameters(withoutStorePrefix(storePrefixed), {
          storePrefixed,
          checkoutContextFields: true,
        }),
      },
    ]);
  }

  private transactionParameters(
    productIdentifier: string,
    options?: { storePrefixed?: string; checkoutContextFields?: boolean },
  ): Slice {
    const eventIdentifier = options?.storePrefixed ?? productIdentifier;
    const installDate = this.collector.deviceAttributes.$appInstallDate;
    return {
      ...this.collector.paywallSlice,
      ...this.collector.presentmentSlice,
      ...(options?.checkoutContextFields ? this.collector.placementParamsSlice : {}),
      ...this.collector.experimentSlice,
      ...this.collector.productSlice[productIdentifier],
      $store: "STRIPE",
      $install_date: typeof installDate === "string" ? installDate : new Date().toISOString(),
      $product_id: eventIdentifier,
      $product_identifier: eventIdentifier,
      ...(options?.checkoutContextFields
        ? {
            $country_code: null,
            $transaction_date: new Date().toISOString(),
            $managed_payments: this.init.managedPayments ?? false,
            $paywall_managed_payments_override: this.init.paywallManagedPaymentsOverride ?? null,
          }
        : {}),
    };
  }

  private async publish(events: CollectorEvent[]): Promise<void> {
    if ((window as Window & { __SW_EVENTS_DISABLED__?: boolean }).__SW_EVENTS_DISABLED__) return;
    const { clientSurface, hostOrigin, sdkVersion } = this.init;
    const stamped = events.map((event) => ({
      ...event,
      event_id: event.event_id ?? crypto.randomUUID(),
      created_at: new Date().toISOString(),
      parameters: {
        ...event.parameters,
        $presentation_id: this.presentationId,
        $client_surface: clientSurface ?? "web-direct",
        ...(hostOrigin ? { $host_origin: hostOrigin } : {}),
        ...(sdkVersion ? { $sdk_version: sdkVersion } : {}),
      },
    }));
    try {
      await fetch(this.collector.url, {
        method: "POST",
        keepalive: true,
        credentials: "omit",
        headers: { ...this.headers, "content-type": "application/json" },
        body: JSON.stringify({ events: stamped }),
      });
    } catch (error) {
      log.error("Failed to report paywall events to the collector", error);
    }
  }
}
