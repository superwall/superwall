import { z } from "zod";

export enum TransportKind {
  WebKitPostMessage = "webkit_post_message",
  EditorIframe = "editor",
  Android = "android",
}

export enum Platform {
  iOS = "ios",
  Android = "android",
  MacOS = "macos",
  UIKitForMac = "uikitformac",
}

export const InitializationParamsSchema = z.object({
  sdkVersion: z.string().optional(),
  transport: z.nativeEnum(TransportKind).default(TransportKind.WebKitPostMessage),
  platform: z.nativeEnum(Platform).default(Platform.iOS),
  enableEditorHover: z
    .string()
    .optional()
    .transform((value) => value === "true"),
});

export const ParameterNames = Object.keys(InitializationParamsSchema.shape);

export type TInitializationParams = z.infer<typeof InitializationParamsSchema>;

export type TPaywallControllerOptions = TInitializationParams;
