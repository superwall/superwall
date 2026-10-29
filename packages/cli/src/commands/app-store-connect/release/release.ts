import { defineAscResource } from "@/core/app-store-connect/resources/define";
import { PHASED_ACTIONS, runReleasePhased, runReleaseRelease, runReleaseStatus, runReleaseSubmit } from "@/core/app-store-connect/resources/release";
import { TARGET_FLAGS } from "@/core/app-store-connect/resources/targets";
import { VERSION_ARG, VERSION_FLAGS } from "@/core/app-store-connect/resources/versions";

export const command = defineAscResource({
  name: "asc release",
  summary: "Ship a version: submit it for review, release it, run its phased release, check where it is",
  details: `submit adds the version to the app's open review submission, or a new one, with any
--subscription, --iap or --group alongside, then submits it. Apple reviews an app's first
in-app purchases and subscriptions only together with a version, so submit them here.
release releases a version that is pending developer release. phased start turns phased
release on before the version is released; pause, resume and complete steer it after.`,
  operations: [
    {
      name: "submit",
      summary: "Submit a version for App Review, with in-app products alongside",
      details: "Adds the version and optional products to a review submission and sets submitted=true, changing the existing review workflow.",
      args: [VERSION_ARG],
      flags: {
        ...VERSION_FLAGS,
        subscription: { ...TARGET_FLAGS.subscription, type: "list", describe: "A subscription to submit with it (repeatable)" },
        iap: { ...TARGET_FLAGS.iap, type: "list", describe: "An in-app purchase to submit with it (repeatable)" },
        group: { ...TARGET_FLAGS.group, type: "list", describe: "A subscription group to submit with it (repeatable)" },
      },
      effect: "destructive",
      run: runReleaseSubmit,
    },
    {
      name: "release",
      summary: "Release a version that is pending developer release",
      args: [VERSION_ARG],
      flags: VERSION_FLAGS,
      effect: "destructive",
      run: runReleaseRelease,
    },
    {
      name: "phased",
      summary: "Start, pause, resume or complete the version's phased release",
      details: "Starts, pauses, resumes or completes phased distribution. Completing releases to all users; other actions replace rollout state, subject to Apple’s transition guards.",
      args: [{ name: "action", describe: "What to do", required: true, choices: PHASED_ACTIONS }, VERSION_ARG],
      flags: VERSION_FLAGS,
      effect: "destructive",
      run: runReleasePhased,
    },
    {
      name: "status",
      summary: "Where the version is: its state, build, review submission and phased release",
      args: [VERSION_ARG],
      flags: VERSION_FLAGS,
      effect: "read",
      run: runReleaseStatus,
    },
  ],
  examples: [
    ["asc release submit 1.2.0 --asc-app com.example.app --subscription <id>", "Submit 1.2.0 with its first subscription"],
    ["asc release status 1.2.0 --asc-app com.example.app", "Where 1.2.0 is"],
    ["asc release phased pause 1.2.0 --asc-app com.example.app", "Pause the rollout"],
  ],
});
