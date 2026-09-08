import type { HostVariables } from "../state";
import { DEFAULT_DEVICE } from "./device";

export const DEFAULT_USER = {
  appUserId: DEFAULT_DEVICE.appUserId,
  email: "preview@example.com",
  firstName: "John",
  lastName: "Doe",
  country: "US",
  language: "en",
} satisfies HostVariables;
