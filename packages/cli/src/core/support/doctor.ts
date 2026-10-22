import type { CommandContext } from "@/program/command";
import { detectDrivers } from "@/core/workflows/agent/drivers/index";
import { readSession } from "@/core/account/storage";
import { detectExisting } from "@/core/codebase/existing";
import { scanProject } from "@/core/codebase/scan";
import { apiKeyFromEnv } from "@/environment";
import { ui } from "@/ui";
import { THEME, fg } from "@/ui/theme";

type Check = [ok: boolean, label: string, value: string];

export async function runDoctor(
  ctx: CommandContext<"optional">,
  deps: { detectDrivers?: typeof detectDrivers } = {},
): Promise<void> {
  ui.intro("Superwall doctor");

  const spin = ui.spinner();
  spin.start("Checking your setup");
  const drivers = await (deps.detectDrivers ?? detectDrivers)();
  const scan = await scanProject(ctx.installDir);
  spin.stop("Checks complete");

  const top = scan.apps[0];
  const existing = top ? detectExisting(top) : null;
  const session = readSession();

  const sdkChecks: Check[] = existing
    ? [
        [existing.sdkInstalled, "SDK", existing.sdkInstalled ? "installed" : "not installed"],
        [existing.configureFound, "configure()", existing.configureFound ? "present" : "missing"],
        [!!existing.apiKey, "API key", existing.apiKey ?? "none in project"],
      ]
    : [];
  const rows: Check[] = [
    [
      drivers.length > 0,
      "Coding agent",
      drivers.map((d) => d.info.displayName).join(", ") || "none found",
    ],
    top
      ? [true, "Project", `${top.framework.name}${top.details ? ` · ${top.details}` : ""}`]
      : scan.unsupported[0]
        ? [
            false,
            "Project",
            `${scan.unsupported[0].framework.name} (not supported by this command)`,
          ]
        : [false, "Project", "not detected"],
    ...sdkChecks,
    [
      !!session || !!apiKeyFromEnv(),
      "Logged in",
      session
        ? (session.userEmail ?? session.orgName ?? "yes")
        : apiKeyFromEnv()
          ? "via SUPERWALL_API_KEY"
          : "no - run `superwall login`",
    ],
  ];

  if (ctx.json) {
    const checks = rows.map(([ok, label, value]) => ({ ok, label, value }));
    return ctx.output.data({ ok: checks.every((check) => check.ok), checks });
  }

  ui.report(
    rows
      .map(
        ([ok, label, value]) =>
          `${ok ? fg(THEME.primary, "✓") : fg(THEME.alert, "✗")} ${label.padEnd(13)} ${value}`,
      )
      .join("\n"),
  );

  const failed = rows.filter(([ok]) => !ok).length;
  ui.outro(
    failed === 0 ? "All checks passed." : `${failed} of ${rows.length} checks need attention.`,
  );
}
