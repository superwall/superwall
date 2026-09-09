import { ENV_API_KEY } from "@/environment";

export const installDirOption = {
  "install-dir": {
    describe: "Directory to set up Superwall in (default: cwd)",
    type: "string" as const,
  },
};

export const apiKeyOption = {
  "api-key": {
    describe: `Superwall public API key (or set ${ENV_API_KEY})`,
    type: "string" as const,
  },
};

export const dryRunOption = {
  "dry-run": {
    type: "boolean" as const,
    describe: "Plan without changing anything",
    hidden: true,
  },
};

export const skillOption = {
  skill: {
    type: "boolean" as const,
    describe: "Print the agent playbook (skill + this project's reference) instead of running",
  },
};

export const RESOURCES = ["orgs", "apps", "products", "campaigns", "paywalls", "entitlements"] as const;

export const API_VERBS = ["get", "post", "patch", "delete"] as const;
