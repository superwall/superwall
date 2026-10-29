import { defineAscResource } from "@/core/app-store-connect/resources/define";
import {
  APP_VERSION_STATES,
  PLATFORMS,
  RELEASE_TYPES,
  runVersionsCreate,
  runVersionsDelete,
  runVersionsGet,
  runVersionsList,
  runVersionsUpdate,
  VERSION_ARG,
  VERSION_FLAGS,
} from "@/core/app-store-connect/resources/versions";

export const command = defineAscResource({
  name: "asc versions",
  summary: "App Store versions: list, inspect, create, change, delete",
  details: `A <version> is the version's id, or its version string (1.2.0) with --asc-app and,
off iOS, --platform. --earliest-release-date (2026-11-01T08:00:00-07:00) goes with
--release-type SCHEDULED.`,
  operations: [
    {
      name: "list",
      summary: "The app's versions, newest first",
      args: [{ name: "asc-app", describe: "The App Store app: its App Store Connect id or bundle ID", required: true }],
      flags: {
        platform: { type: "string", value: "platform", describe: "Only this platform", choices: PLATFORMS },
        appVersionState: { type: "string", value: "state", describe: "Only versions in this state", choices: APP_VERSION_STATES },
        versionString: { type: "string", value: "1.2.0", describe: "Only this version string" },
      },
      effect: "read",
      run: runVersionsList,
    },
    {
      name: "get",
      summary: "One version: its build, localizations and phased release",
      args: [VERSION_ARG],
      flags: VERSION_FLAGS,
      effect: "read",
      run: runVersionsGet,
    },
    {
      name: "create",
      summary: "Create a version",
      flags: {
        ascApp: { type: "string", value: "id|bundle id", describe: "The App Store app", required: true },
        versionString: { type: "string", value: "1.2.0", describe: "The version string customers see", required: true },
        platform: { type: "string", value: "platform", describe: "Its platform (default IOS)", choices: PLATFORMS },
        releaseType: { type: "string", value: "type", describe: "How it is released once approved", choices: RELEASE_TYPES },
        earliestReleaseDate: { type: "string", value: "date", describe: "With SCHEDULED: the earliest release, ISO 8601" },
        copyright: { type: "string", value: "text", describe: "The copyright line, e.g. 2026 Acme Inc." },
      },
      effect: "write",
      run: runVersionsCreate,
    },
    {
      name: "update",
      summary: "Change a version",
      details: "PATCH overwrites version fields, release type and earliest release date; it can change automatic-release behavior.",
      args: [VERSION_ARG],
      flags: {
        ...VERSION_FLAGS,
        versionString: { type: "string", value: "1.2.0", describe: "A new version string" },
        releaseType: { type: "string", value: "type", describe: "How it is released once approved", choices: RELEASE_TYPES },
        earliestReleaseDate: { type: "string", value: "date", describe: "With SCHEDULED: the earliest release, ISO 8601" },
        copyright: { type: "string", value: "text", describe: "The copyright line" },
      },
      effect: "destructive",
      run: runVersionsUpdate,
    },
    {
      name: "delete",
      summary: "Delete a version while it is still editable",
      args: [VERSION_ARG],
      flags: VERSION_FLAGS,
      confirm: true,
      effect: "destructive",
      run: runVersionsDelete,
    },
  ],
  examples: [
    ["asc versions list com.example.app --platform IOS", "Every iOS version of the app"],
    ["asc versions create --asc-app com.example.app --version-string 1.2.0 --release-type MANUAL", "A new iOS version, released by hand"],
    ["asc versions get 1.2.0 --asc-app com.example.app", "A version by its version string"],
  ],
});
