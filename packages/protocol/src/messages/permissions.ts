import { z } from "zod";

export const PermissionTypeSchema = z.enum([
  "notification",
  "background_location",
  "location",
  "read_images",
  "contacts",
  "read_video",
  "camera",
  "tracking",
  "microphone",
]);

export type TPermissionTypeMessage = z.infer<typeof PermissionTypeSchema>;

export const PermissionStatusSchema = z.enum(["granted", "denied", "unsupported"]);

export type TPermissionStatus = z.infer<typeof PermissionStatusSchema>;
