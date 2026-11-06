// Generated from packages/artifact-sdk by its vendor script. Do not edit.
export type MetricInterval = "hour" | "day" | "week" | "month"
export type MetricRequest = {
  readonly metric: string
  readonly context: {
    readonly organizationId: number
    readonly applicationId: number
  }
  readonly from: string
  readonly to: string
  readonly interval: "hour" | "day" | "week" | "month"
  readonly timezone: string
  readonly breakdown: null | string
  readonly filters: {
    readonly [key: string]: ReadonlyArray<string>
  }
}
export type MetricPoint = {
  readonly t: string
  readonly value: number
  readonly breakdown?: null | string
}
export type MetricSeries = {
  readonly points: ReadonlyArray<{
    readonly t: string
    readonly value: number
    readonly breakdown?: null | string
  }>
}
export type ReadoutRequest = {
  readonly metric: string
  readonly context: {
    readonly organizationId: number
    readonly applicationId: number
    readonly campaignId: number
    readonly audienceId: number
    readonly variantIds: ReadonlyArray<number>
    readonly environment: "PRODUCTION" | "SANDBOX"
  }
}
export type ReadoutValue = {
  readonly value: null | number
  readonly variantId: number
  readonly interval?: readonly [number, number]
}
export type ReadoutResult = {
  readonly variants: ReadonlyArray<{
    readonly value: null | number
    readonly variantId: number
    readonly interval?: readonly [number, number]
  }>
}
