// Generated from packages/workspace-sdk by its vendor script. Do not edit.
export type SlotId = "org.page@1" | "app.page@1" | "app.dashboard.widget@1" | "campaign.tab@1" | "user.panel@1" | "user.action@1" | "chart.source@1" | "campaign.metric@1"
export type Environment = "PRODUCTION" | "SANDBOX"
export type DateRange = {
  readonly from: string
  readonly to: string
}
export type OrgPageContextV1 = {
  readonly organizationId: number
}
export type AppPageContextV1 = {
  readonly organizationId: number
  readonly applicationId: number
  readonly environment: "PRODUCTION" | "SANDBOX"
}
export type AppDashboardWidgetContextV1 = {
  readonly organizationId: number
  readonly applicationId: number
  readonly environment: "PRODUCTION" | "SANDBOX"
  readonly dateRange: {
    readonly from: string
    readonly to: string
  }
}
export type CampaignTabContextV1 = {
  readonly organizationId: number
  readonly applicationId: number
  readonly campaignId: number
  readonly audienceId: null | number
  readonly variantIds: ReadonlyArray<number>
  readonly environment: "PRODUCTION" | "SANDBOX"
  readonly dateRange: {
    readonly from: string
    readonly to: string
  }
}
export type UserPanelContextV1 = {
  readonly organizationId: number
  readonly applicationId: number
  readonly appUserId: string
  readonly aliases: ReadonlyArray<string>
  readonly environment: "PRODUCTION" | "SANDBOX"
}
export type UserActionContextV1 = {
  readonly organizationId: number
  readonly applicationId: number
  readonly appUserId: string
  readonly aliases: ReadonlyArray<string>
  readonly environment: "PRODUCTION" | "SANDBOX"
}
export type ChartSourceContextV1 = {
  readonly organizationId: number
  readonly applicationId: number
}
export type CampaignMetricContextV1 = {
  readonly organizationId: number
  readonly applicationId: number
  readonly campaignId: number
  readonly audienceId: number
  readonly variantIds: ReadonlyArray<number>
  readonly environment: "PRODUCTION" | "SANDBOX"
}
export type SlotContexts = {
  readonly "org.page@1": {
    readonly organizationId: number
  }
  readonly "app.page@1": {
    readonly organizationId: number
    readonly applicationId: number
    readonly environment: "PRODUCTION" | "SANDBOX"
  }
  readonly "app.dashboard.widget@1": {
    readonly organizationId: number
    readonly applicationId: number
    readonly environment: "PRODUCTION" | "SANDBOX"
    readonly dateRange: {
      readonly from: string
      readonly to: string
    }
  }
  readonly "campaign.tab@1": {
    readonly organizationId: number
    readonly applicationId: number
    readonly campaignId: number
    readonly audienceId: null | number
    readonly variantIds: ReadonlyArray<number>
    readonly environment: "PRODUCTION" | "SANDBOX"
    readonly dateRange: {
      readonly from: string
      readonly to: string
    }
  }
  readonly "user.panel@1": {
    readonly organizationId: number
    readonly applicationId: number
    readonly appUserId: string
    readonly aliases: ReadonlyArray<string>
    readonly environment: "PRODUCTION" | "SANDBOX"
  }
  readonly "user.action@1": {
    readonly organizationId: number
    readonly applicationId: number
    readonly appUserId: string
    readonly aliases: ReadonlyArray<string>
    readonly environment: "PRODUCTION" | "SANDBOX"
  }
  readonly "chart.source@1": {
    readonly organizationId: number
    readonly applicationId: number
  }
  readonly "campaign.metric@1": {
    readonly organizationId: number
    readonly applicationId: number
    readonly campaignId: number
    readonly audienceId: number
    readonly variantIds: ReadonlyArray<number>
    readonly environment: "PRODUCTION" | "SANDBOX"
  }
}
export type SlotContext<S extends SlotId> = SlotContexts[S]
