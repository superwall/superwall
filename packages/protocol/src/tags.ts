import { z } from "zod";

const OpenURLElementSchema = z.object({
  "open-url": z.string(),
});

export type TOpenURLElement = z.infer<typeof OpenURLElementSchema>;

const OpenURLExternalElementSchema = z.object({
  "open-url-external": z.string(),
});

export type TOpenURLExternalElement = z.infer<typeof OpenURLExternalElementSchema>;

const OpenDeepLinkElementSchema = z.object({
  "open-deep-link": z.string(),
});

export type TOpenDeepLinkElement = z.infer<typeof OpenDeepLinkElementSchema>;

const CloseElementSchema = z.object({
  close: z.string(),
});

export type TCloseElement = z.infer<typeof CloseElementSchema>;

const CustomElementSchema = z.object({
  custom: z.string(),
});

export type TCustomElement = z.infer<typeof CustomElementSchema>;

const RestoreElementSchema = z.object({
  restore: z.string(),
});

export type TRestoreElement = z.infer<typeof RestoreElementSchema>;

const VarElementSchema = z.object({
  var: z.string(),
});

export type TVarElement = z.infer<typeof VarElementSchema>;

const VideoElementSchema = z.object({
  video: z.string(),
});

export type TVideoElement = z.infer<typeof VideoElementSchema>;

const ContainerElementSchema = z.object({
  container: z.string(),
});

export type TContainerElement = z.infer<typeof ContainerElementSchema>;

const PurchaseElementSchema = z.object({
  purchase: z.string(),
});

export type TPurchaseElement = z.infer<typeof PurchaseElementSchema>;

export const PaywallElementSchema = z.union([
  OpenURLElementSchema,
  OpenURLExternalElementSchema,
  OpenDeepLinkElementSchema,
  CloseElementSchema,
  CustomElementSchema,
  RestoreElementSchema,
  VarElementSchema,
  VideoElementSchema,
  ContainerElementSchema,
  PurchaseElementSchema,
]);

export type TPaywallElement = z.infer<typeof PaywallElementSchema>;

export const attributeNames = [
  "open-url",
  "open-url-external",
  "open-deep-link",
  "close",
  "restore",
  "var",
  "video",
  "purchase",
  "custom",
] as const;
