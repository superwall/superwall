import { defineAscResource } from "@/core/app-store-connect/resources/define";
import { METADATA_FIELDS, runMetadataAdd, runMetadataGet, runMetadataList, runMetadataUpdate } from "@/core/app-store-connect/resources/metadata";
import { VERSION_ARG, VERSION_FLAGS } from "@/core/app-store-connect/resources/versions";

export const command = defineAscResource({
  name: "asc metadata",
  summary: "A version's App Store text per locale: What's New, description, keywords, URLs",
  operations: [
    {
      name: "list",
      summary: "The version's locales and which fields each has",
      args: [VERSION_ARG],
      flags: VERSION_FLAGS,
      effect: "read",
      run: runMetadataList,
    },
    {
      name: "get",
      summary: "The version's text in one locale",
      args: [VERSION_ARG],
      flags: { ...VERSION_FLAGS, locale: { type: "string", value: "locale", describe: "The locale, e.g. en-US", required: true } },
      effect: "read",
      run: runMetadataGet,
    },
    {
      name: "update",
      summary: "Change the version's text in one locale",
      args: [VERSION_ARG],
      flags: { ...VERSION_FLAGS, locale: { type: "string", value: "locale", describe: "The locale to change, e.g. en-US", required: true }, ...METADATA_FIELDS },
      effect: "write",
      run: runMetadataUpdate,
    },
    {
      name: "add",
      summary: "Add a locale to the version, with its text",
      args: [VERSION_ARG],
      flags: { ...VERSION_FLAGS, locale: { type: "string", value: "locale", describe: "The locale to add, e.g. de-DE", required: true }, ...METADATA_FIELDS },
      effect: "write",
      run: runMetadataAdd,
    },
  ],
  examples: [
    ["asc metadata list 1.2.0 --asc-app com.example.app", "The locales of version 1.2.0"],
    ["asc metadata update 1.2.0 --asc-app com.example.app --locale en-US --whats-new 'Faster sync'", "Set What's New in English"],
  ],
});
