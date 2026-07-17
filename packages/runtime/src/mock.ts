import type {
  ITransport,
  TIncomingHandler,
  TIncomingMessage,
  TIncomingMessageCallbackResult,
  TOutgoingMessage,
  TPermissionStatus,
  TPermissionTypeMessage,
} from "@superwall/protocol";
import { normalizeProductSlot, type SuperwallConfig } from "./config";
import {
  createSuperwallProduct,
  type SuperwallProduct,
  type SuperwallProductInput,
  type SuperwallProductVariables,
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
   * Products the mock SDK delivers. Defaults to the config's product slots
   * with realistic synthesized variables (price, period, trial…).
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
  /** Outcome of purchase requests. Defaults to "completed". */
  purchaseOutcome?:
    | SuperwallMockPurchaseOutcome
    | ((
        context: SuperwallMockPurchaseContext,
      ) => SuperwallMockPurchaseOutcome | Promise<SuperwallMockPurchaseOutcome>);
  /** Whether restore emits a `transaction_complete`. Defaults to "completed". */
  restoreOutcome?: "completed" | "none";
  /** Permission request responses. Defaults to "granted". */
  permissions?: Partial<Record<TPermissionTypeMessage, TPermissionStatus>>;
  /** Callback responses by callback name. Defaults to `{ status: "success" }`. */
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

const MOCK_VARIABLE_PRESETS: readonly SuperwallProductVariables[] = [
  {
    price: "$39.99",
    rawPrice: 39.99,
    period: "year",
    periodly: "yearly",
    periodYears: 1,
    monthlyPrice: "$3.33",
    weeklyPrice: "$0.77",
    dailyPrice: "$0.11",
    trialPeriodDays: 7,
    trialPeriodText: "7-day",
    currencyCode: "USD",
    currencySymbol: "$",
  },
  {
    price: "$9.99",
    rawPrice: 9.99,
    period: "month",
    periodly: "monthly",
    periodMonths: 1,
    monthlyPrice: "$9.99",
    weeklyPrice: "$2.31",
    dailyPrice: "$0.33",
    trialPeriodDays: 0,
    currencyCode: "USD",
    currencySymbol: "$",
  },
  {
    price: "$4.99",
    rawPrice: 4.99,
    period: "week",
    periodly: "weekly",
    periodWeeks: 1,
    weeklyPrice: "$4.99",
    dailyPrice: "$0.71",
    trialPeriodDays: 0,
    currencyCode: "USD",
    currencySymbol: "$",
  },
];

const MOCK_DEVICE_VARIABLES: SuperwallDeviceVariables = {
  platform: "iOS",
  deviceModel: "iPhone17,2",
  osVersion: "18.0",
  appVersion: "1.0.0",
  locale: "en_US",
  languageCode: "en",
  regionCode: "US",
  currencyCode: "USD",
  currencySymbol: "$",
  interfaceStyle: "Light",
  isSandbox: "true",
  sdkVersion: "4.0.0",
  daysSinceInstall: 0,
  totalPaywallViews: 1,
};

/**
 * Builds mock products from a paywall config: each product slot gets
 * realistic synthesized variables so paywalls render fully in dev/preview.
 */
export const mockProductsFromConfig = (config: SuperwallConfig | undefined): SuperwallProduct[] =>
  Object.entries(config?.products ?? {}).map(([reference, input], index) => {
    const slot = normalizeProductSlot(input);
    const preset = MOCK_VARIABLE_PRESETS[index % MOCK_VARIABLE_PRESETS.length];
    const productId = slot.productId ?? `${reference}_mock`;

    return {
      reference,
      product: reference,
      id: productId,
      productId,
      productIdentifier: productId,
      variables: { ...preset, identifier: productId },
      source: "placeholder",
    };
  });

export const mockOptionsFromConfig = (
  config: SuperwallConfig | undefined,
  options: SuperwallMockOptions = {},
): SuperwallMockOptions => ({
  ...options,
  products: options.products ?? mockProductsFromConfig(config),
});

const DAY_MS = 24 * 60 * 60 * 1000;

const trialPeriodDaysOf = (product: SuperwallProduct): number => {
  const days = product.variables.trialPeriodDays;
  return typeof days === "number" ? days : 0;
};

/**
 * A paywall-side transport with a simulated native SDK on the other end.
 *
 * The mock host answers `ping` with `paywall_open`, `products`,
 * `template_variables` (products + device + user + params), and trial
 * eligibility; resolves purchase/restore with transactions (including
 * `freeTrial_start` for trial products); grants permissions; and answers
 * callbacks — so a headless paywall is fully interactive in a plain browser
 * (local dev, dashboard preview, tests).
 */
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
        this.respond([
          {
            event_name: "permission_result",
            permission_type: message.permission_type,
            request_id: message.request_id,
            status: this.options.permissions?.[message.permission_type] ?? "granted",
          },
        ]);
        break;
      }
      case "request_callback": {
        const callback = this.options.callbacks?.[message.name];
        const result =
          typeof callback === "function"
            ? await callback(message.variables)
            : (callback ?? { status: "success" as const });

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
