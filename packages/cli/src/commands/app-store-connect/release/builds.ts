import { defineAscResource } from "@/core/app-store-connect/resources/define";
import { PROCESSING_STATES, runBuildsAttach, runBuildsExpire, runBuildsGet, runBuildsList } from "@/core/app-store-connect/resources/builds";
import { PLATFORMS, VERSION_ARG, VERSION_FLAGS } from "@/core/app-store-connect/resources/versions";

export const command = defineAscResource({
  name: "asc builds",
  summary: "The app's uploaded builds: list, inspect, attach to a version, expire",
  operations: [
    {
      name: "list",
      summary: "The app's builds, newest upload first",
      args: [{ name: "asc-app", describe: "The App Store app: its App Store Connect id or bundle ID", required: true }],
      flags: {
        versionString: { type: "string", value: "1.2.0", describe: "Only builds of this app version" },
        version: { type: "string", value: "build", describe: "Only this build number" },
        processingState: { type: "string", value: "state", describe: "Only builds in this processing state", choices: PROCESSING_STATES },
        platform: { type: "string", value: "platform", describe: "Only this platform", choices: PLATFORMS },
        limit: { type: "number", value: "n", describe: "How many builds (default 20, at most 200)" },
      },
      effect: "read",
      run: runBuildsList,
    },
    {
      name: "get",
      summary: "One build: its version, processing state and the App Store version it is attached to",
      args: [{ name: "id", describe: "The build's id", required: true }],
      effect: "read",
      run: runBuildsGet,
    },
    {
      name: "attach",
      summary: "Attach a build to an App Store version, replacing its current one",
      args: [{ name: "id", describe: "The build's id", required: true }, VERSION_ARG],
      flags: VERSION_FLAGS,
      confirm: true,
      effect: "destructive",
      run: runBuildsAttach,
    },
    {
      name: "expire",
      summary: "Expire a build: no tester can install it and no version can use it",
      args: [{ name: "id", describe: "The build's id", required: true }],
      confirm: true,
      effect: "destructive",
      run: runBuildsExpire,
    },
  ],
  examples: [
    ["asc builds list com.example.app --version-string 1.2.0 --processing-state VALID", "The usable builds of 1.2.0"],
    ["asc builds attach <build> 1.2.0 --asc-app com.example.app", "Put a build on version 1.2.0"],
  ],
});
