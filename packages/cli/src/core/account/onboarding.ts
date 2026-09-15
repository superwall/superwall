import { Integration } from "@/environment";
import type { OnboardSetup, ProvisionedApp } from "@/core/auth/login";
import type { DetectedApp } from "@/core/project/scan";
import { setOnboardedApp } from "@/core/state/config";
import { ui } from "@/ui";

export interface OnboardingHooks {
  onOnboard: () => Promise<OnboardSetup | null>;
  onProvisioned: (result: ProvisionedApp) => void;
  provisioned: () => ProvisionedApp | null;
}

export function onboardingHooks(app?: DetectedApp): OnboardingHooks {
  const ref: { current: ProvisionedApp | null } = { current: null };
  const platform =
    app?.integration === Integration.swift
      ? ("ios" as const)
      : app?.integration === Integration.android
        ? ("android" as const)
        : app?.integration === Integration.web
          ? ("web" as const)
          : undefined;

  return {
    onOnboard: async () => {
      let onboardApp: OnboardSetup["app"];
      if (app && platform) {
        ui.info(`Welcome to Superwall! Let's get \`${app.name}\` set up.`);
        const create = await ui.confirm({
          message: `Create \`${app.name}\` as your first app?`,
        });
        if (create === null) return null;
        if (create) onboardApp = { name: app.name, platform };
      } else {
        ui.info("Welcome to Superwall! Let's set up your account.");
      }
      const orgName = await ui.text({
        message: "What's your organization called?",
        placeholder: "Acme Inc",
        initialValue: app?.name,
        validate: (v) => (v?.trim() ? undefined : "Required"),
      });
      if (orgName === null) return null;
      return { orgName: orgName.trim(), app: onboardApp };
    },
    onProvisioned: (result) => {
      ref.current = result;
      if (app && result.publicApiKey) {
        setOnboardedApp(app.path, {
          publicApiKey: result.publicApiKey,
          projectId: result.projectId,
          applicationId: result.applicationId,
        });
      }
    },
    provisioned: () => ref.current,
  };
}
