import type {
  ITransport,
  TIncomingHandler,
  TIncomingMessage,
  TIncomingMessageCallbackResult,
  TOutgoingMessage,
  TPermissionStatus,
  TPermissionTypeMessage,
} from "@superwall/protocol";
import { normalizePlatform, normalizeProductSlot, type SuperwallConfig } from "./config";
import {
  createSuperwallProduct,
  type SuperwallProduct,
  type SuperwallProductInput,
} from "./products";
import type {
  SuperwallDeviceVariables,
  SuperwallExperiment,
  SuperwallPlacementParams,
  SuperwallUserVariables,
} from "./session/variables";

export type SuperwallMockPurchaseOutcome = "completed" | "abandoned";

export type SuperwallMockPurchaseContext = {
  reference: string;
  productIdentifier?: string;
};

export type SuperwallMockCallbackResult = {
  status: TIncomingMessageCallbackResult["status"];
  data?: Record<string, unknown>;
};

export type SuperwallMockOptions = {
  /** Identity sent in `paywall_open`. */
  paywall?: { id?: string; identifier?: string };
  /**
   * Products the mock SDK delivers. Defaults to the config's product slots,
   * carrying only the product identifier — real product data comes from
   * Superwall, never from the mock.
   */
  products?: readonly SuperwallProductInput[];
  /** Device variables merged over the mock defaults. */
  device?: SuperwallDeviceVariables;
  /** User attributes delivered with template variables. */
  user?: SuperwallUserVariables;
  /** Placement params delivered with template variables. */
  params?: SuperwallPlacementParams;
  /** Experiment assignment to report. Omitted by default. */
  experiment?: SuperwallExperiment;
  /** Extra top-level template variables. */
  variables?: Record<string, unknown>;
  /**
   * Introductory-offer eligibility the mock reports. Defaults to true when
   * any product has trial variables.
   */
  trialEligible?: boolean;
  purchaseOutcome?:
    | SuperwallMockPurchaseOutcome
    | ((
        context: SuperwallMockPurchaseContext,
      ) => SuperwallMockPurchaseOutcome | Promise<SuperwallMockPurchaseOutcome>);
  /** Whether restore emits a `transaction_complete`. Defaults to "completed". */
  restoreOutcome?: "completed" | "none";
  /** Permission request responses. Defaults to "granted". */
  permissions?: Partial<Record<TPermissionTypeMessage, TPermissionStatus>>;
  /** Answers a permission request per call, for hosts that decide at runtime. */
  onPermission?: (
    permissionType: TPermissionTypeMessage,
  ) => TPermissionStatus | Promise<TPermissionStatus>;
  /** Answers a callback request per call, for hosts that decide at runtime. */
  onCallback?: (
    name: string,
    variables?: Record<string, unknown>,
  ) => SuperwallMockCallbackResult | Promise<SuperwallMockCallbackResult>;
  callbacks?: Record<
    string,
    | SuperwallMockCallbackResult
    | ((
        variables?: Record<string, unknown>,
      ) => SuperwallMockCallbackResult | Promise<SuperwallMockCallbackResult>)
  >;
  /** Simulated SDK response delay. Defaults to 0. */
  latencyMs?: number;
  /** Observe every message the paywall sends to the mock host. */
  onOutgoing?: (message: TOutgoingMessage) => void;
};

export const MOCK_DEVICE_VARIABLES: SuperwallDeviceVariables = {
  platform: "iOS",
  deviceModel: "iPhone17,2",
  osVersion: "18.0",
  appVersion: "1.0.0",
  deviceLocale: "en_US",
  deviceLanguageCode: "en",
  regionCode: "US",
  preferredLocale: "en-US",
  preferredLanguageCode: "en",
  preferredRegionCode: "US",
  deviceCurrencyCode: "USD",
  deviceCurrencySymbol: "$",
  interfaceStyle: "Light",
  isSandbox: "true",
  sdkVersion: "4.0.0",
  daysSinceInstall: 0,
  totalPaywallViews: 1,
};

export const mockProductsFromConfig = (
  config: SuperwallConfig | undefined,
  devicePlatform?: string,
): SuperwallProduct[] =>
  Object.entries(config?.products ?? {}).map(([reference, input]) => {
    const slot = normalizeProductSlot(input, normalizePlatform(devicePlatform));
    const productId = slot.productId ?? reference;

    return {
      reference,
      product: reference,
      id: productId,
      productId,
      productIdentifier: productId,
      variables: { identifier: productId },
      source: "placeholder",
    };
  });

export const mockOptionsFromConfig = (
  config: SuperwallConfig | undefined,
  options: SuperwallMockOptions = {},
): SuperwallMockOptions => ({
  ...options,
  products:
    options.products ??
    mockProductsFromConfig(
      config,
      typeof options.device?.platform === "string" ? options.device.platform : undefined,
    ),
});

const DAY_MS = 24 * 60 * 60 * 1000;

const trialPeriodDaysOf = (product: SuperwallProduct): number => {
  // The SDK sends period counts as strings ("7"), so a `typeof === "number"`
  // check silently reports every product as trial-less on a device.
  const days = Number(product.variables.trialPeriodDays);
  return Number.isFinite(days) ? days : 0;
};

export class MockSuperwallTransport implements ITransport {
  private handlers: TIncomingHandler[] = [];
  private listening = false;
  private options: SuperwallMockOptions;
  private products: SuperwallProduct[];

  constructor(options: SuperwallMockOptions = {}) {
    this.options = options;
    this.products = (options.products ?? []).map((input) => {
      const product = createSuperwallProduct(input);
      return product.source === "unknown" ? { ...product, source: "placeholder" } : product;
    });
  }

  public addListener(handler: TIncomingHandler) {
    this.handlers.push(handler);
  }

  public startListening() {
    this.listening = true;
  }

  public accept(message: TIncomingMessage) {
    if (!this.listening) return;
    this.handlers.forEach((handler) => handler(message));
  }

  public postMessage(message: TOutgoingMessage) {
    this.options.onOutgoing?.(message);
    this.handleOutgoing(message).catch((error) => {
      console.error("[MockSuperwallTransport] Failed to handle outgoing message", {
        event: message.event_name,
        error,
      });
    });
  }

  private get trialEligible(): boolean {
    return (
      this.options.trialEligible ?? this.products.some((product) => trialPeriodDaysOf(product) > 0)
    );
  }

  private respond(messages: TIncomingMessage[]) {
    const deliver = () => {
      messages.forEach((message) => this.accept(message));
    };

    const latency = this.options.latencyMs ?? 0;
    if (latency > 0) {
      setTimeout(deliver, latency);
    } else {
      queueMicrotask(deliver);
    }
  }

  private async handleOutgoing(message: TOutgoingMessage) {
    switch (message.event_name) {
      case "ping": {
        const replies: TIncomingMessage[] = [
          {
            event_name: "paywall_open",
            paywall_id: this.options.paywall?.id ?? "mock-paywall",
            paywall_identifier: this.options.paywall?.identifier ?? "mock-paywall-identifier",
          },
          {
            event_name: "products",
            products: this.products.map((product) => ({
              product: product.reference,
              productId: product.productIdentifier ?? product.productId ?? product.reference,
            })),
          },
          {
            event_name: "template_variables",
            variables: {
              ...this.options.variables,
              device: { ...MOCK_DEVICE_VARIABLES, ...this.options.device },
              user: this.options.user ?? {},
              params: this.options.params ?? {},
              products: [
                Object.fromEntries(
                  this.products.map((product) => [product.reference, product.variables]),
                ),
              ],
            },
          },
          {
            event_name: "template_substitutions_prefix",
            prefix: this.trialEligible ? "freeTrial" : null,
          },
        ];

        if (this.options.experiment) {
          replies.push({ event_name: "experiment", ...this.options.experiment });
        }

        this.respond(replies);
        break;
      }
      case "purchase": {
        const outcome = await this.resolvePurchaseOutcome({
          reference: message.product,
          productIdentifier: message.product_identifier,
        });

        const replies: TIncomingMessage[] = [
          {
            event_name: outcome === "completed" ? "transaction_complete" : "transaction_abandon",
            product: message.product,
            product_identifier: message.product_identifier,
          },
        ];

        const product = this.products.find((candidate) => candidate.reference === message.product);
        const trialDays = product ? trialPeriodDaysOf(product) : 0;
        if (outcome === "completed" && this.trialEligible && trialDays > 0) {
          replies.push({
            event_name: "freeTrial_start",
            product_identifier: message.product_identifier,
            trial_end_date: new Date(Date.now() + trialDays * DAY_MS).toISOString(),
          });
        }

        this.respond(replies);
        break;
      }
      case "restore": {
        if ((this.options.restoreOutcome ?? "completed") === "completed") {
          this.respond([{ event_name: "transaction_complete" }]);
        }
        break;
      }
      case "request_permission": {
        const status =
          this.options.permissions?.[message.permission_type] ??
          (this.options.onPermission
            ? await this.options.onPermission(message.permission_type)
            : "granted");

        this.respond([
          {
            event_name: "permission_result",
            permission_type: message.permission_type,
            request_id: message.request_id,
            status,
          },
        ]);
        break;
      }
      case "request_callback": {
        const callback = this.options.callbacks?.[message.name];
        const result =
          typeof callback === "function"
            ? await callback(message.variables)
            : (callback ??
              (this.options.onCallback
                ? await this.options.onCallback(message.name, message.variables)
                : { status: "success" as const }));

        this.respond([
          {
            event_name: "callback_result",
            request_id: message.request_id,
            name: message.name,
            status: result.status,
            data: result.data,
          },
        ]);
        break;
      }
      default:
        break;
    }
  }

  private resolvePurchaseOutcome(context: SuperwallMockPurchaseContext) {
    const outcome = this.options.purchaseOutcome ?? "completed";
    return typeof outcome === "function" ? outcome(context) : outcome;
  }
}

export const createMockSuperwallTransport = (options: SuperwallMockOptions = {}) =>
  new MockSuperwallTransport(options);
