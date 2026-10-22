import type { AnyCommand, Channel } from "@/program/command";
import { CHANNEL } from "@/environment";
import { command as login } from "./account/login";
import { command as logout } from "./account/logout";
import { command as whoami } from "./account/whoami";
import { command as query } from "./analytics/query";
import { command as del } from "./api/delete";
import { command as apiDocs } from "./api/docs";
import { command as get } from "./api/get";
import { command as patch } from "./api/patch";
import { command as post } from "./api/post";
import { command as ascApps } from "./app-store-connect/store/apps";
import { command as ascAvailability } from "./app-store-connect/store/availability";
import { command as ascBuilds } from "./app-store-connect/release/builds";
import { command as ascDelete } from "./app-store-connect/api/delete";
import { command as ascDocs } from "./app-store-connect/api/docs";
import { command as ascGet } from "./app-store-connect/api/get";
import { command as ascIaps } from "./app-store-connect/store/iaps";
import { command as ascLocalizations } from "./app-store-connect/store/localizations";
import { command as ascMetadata } from "./app-store-connect/release/metadata";
import { command as ascKeysCreate } from "./app-store-connect/keys/create";
import { command as ascKeysDelete } from "./app-store-connect/keys/delete";
import { command as ascKeysImport } from "./app-store-connect/keys/import";
import { command as ascKeysList } from "./app-store-connect/keys/list";
import { command as ascKeysSources } from "./app-store-connect/keys/sources";
import { command as ascKeysUpdate } from "./app-store-connect/keys/update";
import { command as ascNotificationUrlCheck } from "./app-store-connect/notification-url/check";
import { command as ascNotificationUrlSet } from "./app-store-connect/notification-url/set";
import { command as ascOffers } from "./app-store-connect/store/offers";
import { command as ascPatch } from "./app-store-connect/api/patch";
import { command as ascPost } from "./app-store-connect/api/post";
import { command as ascPrices } from "./app-store-connect/store/prices";
import { command as ascProducts } from "./app-store-connect/store/products";
import { command as ascRelease } from "./app-store-connect/release/release";
import { command as ascScreenshots } from "./app-store-connect/store/screenshots";
import { command as ascSubmit } from "./app-store-connect/store/submit";
import { command as ascSubscriptionGroups } from "./app-store-connect/store/subscription-groups";
import { command as setupApple } from "./app-store-connect/setup/apple";
import { command as ascSubscriptions } from "./app-store-connect/store/subscriptions";
import { command as ascVersions } from "./app-store-connect/release/versions";
import { command as asa } from "./apple-search-ads/asa";
import { command as asaDelete } from "./apple-search-ads/api/delete";
import { command as asaDocs } from "./apple-search-ads/api/docs";
import { command as asaGet } from "./apple-search-ads/api/get";
import { command as asaKeys } from "./apple-search-ads/keys";
import { command as asaPost } from "./apple-search-ads/api/post";
import { command as asaPut } from "./apple-search-ads/api/put";
import { command as build } from "./paywalls/build";
import { command as create } from "./paywalls/create";
import { command as dev } from "./paywalls/dev";
import { command as promote } from "./paywalls/promote";
import { command as publish } from "./paywalls/publish";
import { command as push } from "./paywalls/push";
import { command as apps } from "./main/apps";
import { command as bootstrap } from "./main/bootstrap";
import { command as campaigns } from "./main/campaigns";
import { command as entitlements } from "./main/entitlements";
import { command as events } from "./main/events";
import { command as paywalls } from "./main/paywalls";
import { command as products } from "./main/products";
import { command as users } from "./main/users";
import { command as webhooks } from "./main/webhooks";
import { command as doctor } from "./support/doctor";
import { command as feedback } from "./support/feedback";
import { command as skills } from "./support/skills";
import { command as upgrade } from "./support/upgrade";
import { command as integrate } from "./workflows/integrate";
import { command as migrate } from "./workflows/migrate";
import { command as review } from "./workflows/review";

export interface Section {
  title: string;
  commands: readonly string[];
}

export interface Topic {
  name: string;
  summary: string;
  details?: string;
  sections?: readonly Section[];
}

export interface Group {
  id: string;
  title: string;
  prefix?: string;
  folders?: Readonly<Record<string, readonly string[]>>;
  channel?: Channel;
  notes?: readonly string[];
  topics?: readonly Topic[];
  commands: readonly AnyCommand[];
}

export const GROUPS: readonly Group[] = [
  {
    id: "workflows",
    title: "Workflows",
    notes: ["Each takes --skill to print the playbook instead of running."],
    commands: [integrate, review, migrate],
  },
  {
    id: "paywalls",
    title: "Paywalls & funnels",
    channel: "next",
    notes: [
      "push and publish take -m <note> to record why, in the source commit.",
      "All four take --platform <p> when a project pushes to several platforms.",
    ],
    commands: [create, dev, build, push, promote, publish],
  },
  {
    id: "main",
    title: "Commands",
    notes: ["superwall <command> --help lists its operations; <operation> --help, its flags."],
    commands: [bootstrap, apps, products, entitlements, campaigns, paywalls, users, webhooks, events],
  },
  {
    id: "analytics",
    title: "Analytics",
    commands: [query],
  },
  {
    id: "api",
    title: "API",
    prefix: "api",
    topics: [
      {
        name: "api",
        summary: "The Superwall API reference",
        details: "Search the reference for any endpoint, its parameters and body. get, post, patch and delete send any request to it.",
      },
    ],
    commands: [apiDocs, get, post, patch, del],
  },
  {
    id: "app-store-connect",
    title: "App Store Connect",
    prefix: "asc",
    folders: {
      store: [
        "asc apps",
        "asc products",
        "asc subscription-groups",
        "asc subscriptions",
        "asc iaps",
        "asc localizations",
        "asc prices",
        "asc offers",
        "asc availability",
        "asc screenshots",
        "asc submit",
      ],
      release: ["asc versions", "asc builds", "asc metadata", "asc release"],
      api: ["asc get", "asc post", "asc patch", "asc delete", "asc docs"],
    },
    topics: [
      { name: "setup", summary: "Set up an integration in one step" },
      {
        name: "asc",
        summary: "The App Store Connect API through Superwall's signed proxy: no .p8 or JWT",
        sections: [
          { title: "Keys and notifications", commands: ["keys", "notification-url"] },
          { title: "Your App Store apps", commands: ["apps", "products"] },
          { title: "What they sell", commands: ["subscription-groups", "subscriptions", "iaps"] },
          { title: "Store details", commands: ["localizations", "prices", "offers", "availability", "screenshots"] },
          { title: "App Review", commands: ["submit"] },
          { title: "Releases", commands: ["versions", "builds", "metadata", "release"] },
          { title: "Any request", commands: ["get", "post", "patch", "delete"] },
          { title: "Reference", commands: ["docs"] },
        ],
      },
      {
        name: "asc keys",
        summary: "An app's Apple keys, and your organization's",
        details: `Each iOS app keeps two keys in Superwall:
  api_key       App Store Connect API key: reads products, sets the notification URL
  purchase_key  In-App Purchase key: reads transactions for one bundle ID
Without --app, list, create and delete act on your organization's keys, the ones the signed
proxy uses. No command prints a private key, and none revokes a key at Apple.`,
      },
      {
        name: "asc notification-url",
        summary: "Where Apple sends the app's purchase events",
        details: "Apple sends an app's purchase events to one URL per environment (production, sandbox).",
      },
    ],
    commands: [
      setupApple,
      ascKeysList,
      ascKeysCreate,
      ascKeysUpdate,
      ascKeysDelete,
      ascKeysImport,
      ascKeysSources,
      ascNotificationUrlCheck,
      ascNotificationUrlSet,
      ascApps,
      ascProducts,
      ascSubscriptionGroups,
      ascSubscriptions,
      ascIaps,
      ascLocalizations,
      ascPrices,
      ascOffers,
      ascAvailability,
      ascScreenshots,
      ascSubmit,
      ascVersions,
      ascBuilds,
      ascMetadata,
      ascRelease,
      ascGet,
      ascPost,
      ascPatch,
      ascDelete,
      ascDocs,
    ],
  },
  {
    id: "apple-search-ads",
    title: "Apple Search Ads",
    prefix: "asa",
    folders: { api: ["asa get", "asa post", "asa put", "asa delete", "asa docs"] },
    commands: [asa, asaKeys, asaGet, asaPost, asaPut, asaDelete, asaDocs],
  },
  {
    id: "account",
    title: "Account",
    commands: [login, logout, whoami],
  },
  {
    id: "support",
    title: "Support & updates",
    commands: [doctor, skills, upgrade, feedback],
  },
];

function visible(channel: Channel | undefined): boolean {
  return channel === undefined || channel === CHANNEL();
}

export function listGroups(): Group[] {
  return GROUPS.filter((group) => visible(group.channel)).map((group) => ({
    ...group,
    commands: group.commands.filter((command) => visible(command.channel)),
  }));
}
