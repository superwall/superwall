// Generated from packages/workspace-sdk by its vendor script. Do not edit.
export type Theme = {
  readonly mode: "light" | "dark"
  readonly tokens: {
    readonly [key: string]: string
  }
}
export type HostMessage = {
  readonly _tag: "connect"
  readonly theme: {
    readonly mode: "light" | "dark"
    readonly tokens: {
      readonly [key: string]: string
    }
  }
  readonly context: unknown
  readonly protocol: "superwall-workspace@1"
  readonly nonce: string
} | {
  readonly _tag: "context.update"
  readonly context: unknown
  readonly protocol: "superwall-workspace@1"
  readonly nonce: string
} | {
  readonly _tag: "theme"
  readonly theme: {
    readonly mode: "light" | "dark"
    readonly tokens: {
      readonly [key: string]: string
    }
  }
  readonly protocol: "superwall-workspace@1"
  readonly nonce: string
} | {
  readonly _tag: "visibility"
  readonly visible: boolean
  readonly protocol: "superwall-workspace@1"
  readonly nonce: string
}
export type AppMessage = {
  readonly _tag: "ready"
  readonly protocol: "superwall-workspace@1"
  readonly nonce: string
} | {
  readonly _tag: "error"
  readonly message: string
  readonly protocol: "superwall-workspace@1"
  readonly nonce: string
} | {
  readonly _tag: "resize"
  readonly height: number
  readonly protocol: "superwall-workspace@1"
  readonly nonce: string
} | {
  readonly _tag: "toast"
  readonly kind: "info" | "success" | "error"
  readonly message: string
  readonly protocol: "superwall-workspace@1"
  readonly nonce: string
} | {
  readonly _tag: "navigate"
  readonly to: "campaign" | "user" | "paywall" | "workspace"
  readonly params: {
    readonly [key: string]: string
  }
  readonly protocol: "superwall-workspace@1"
  readonly nonce: string
} | {
  readonly _tag: "openEntrypoint"
  readonly entrypointId: string
  readonly protocol: "superwall-workspace@1"
  readonly nonce: string
} | {
  readonly _tag: "actionResult"
  readonly protocol: "superwall-workspace@1"
  readonly nonce: string
  readonly status: "success" | "error" | "cancelled"
  readonly message?: string
  readonly refresh?: ReadonlyArray<"campaign" | "user">
}
