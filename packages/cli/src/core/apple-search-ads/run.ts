import type { CommandContext } from "@/program/command";
import { asaActions, asaGroups } from "@/core/apple-search-ads/catalog";
import { renderAsaHelp } from "@/core/apple-search-ads/help";
import { currencyResolver, runAsaOperation } from "@/core/apple-search-ads/operations";
import { listOf, printResult } from "@/core/apple-search-ads/output";
import { resolveAsaApp, runAsaRequest, withAppleErrors } from "@/core/apple-search-ads/request";
import { parseParams } from "@/core/api/params";
import { textField } from "@/core/json";
import { apiCall } from "@/ui/spinner";

interface AsaInput {
  words: string[];
  flags: { [x: string]: unknown; };
}

export async function runAsa(ctx: CommandContext<"required">, { words, flags }: AsaInput): Promise<void> {
  const [target, action, value, ...extra] = words;
  if (!target) {
    const help = renderAsaHelp([]);
    return ctx.json ? ctx.output.data({ markdown: help }) : ctx.output.text(help);
  }
  if (extra.length) throw new Error(`\`superwall asa\` doesn't take "${extra.join(" ")}".`);
  const data = listOf(flags.d);
  const orgId = textField(flags, "orgId");

  if (target.startsWith("/")) {
    return ctx.output.data(await runAsaRequest(ctx, ctx.api, { verb: "get", path: target, data, orgId }));
  }

  const params = parseParams(data);
  if (!asaGroups().includes(target)) {
    throw new Error(
      `asa has no "${target}". It takes: ${asaGroups().join(", ")}, docs, keys, get, post, put, delete, or a /path.\nRun superwall asa --help for what each does.`,
    );
  }
  const resolvedAction = action ?? (target === "me" ? "get" : "list");
  if (!asaActions(target).includes(resolvedAction)) {
    throw new Error(
      `asa ${target} has no "${resolvedAction}". It takes: ${asaActions(target).join(", ")}.\nRun superwall asa ${target} --help for what each does.`,
    );
  }
  const { app: asaApp, api } = await resolveAsaApp(ctx, ctx.api);
  const input = { group: target, action: resolvedAction, positional: value, flags, params };
  const currency = currencyResolver(api, asaApp.id, textField(flags, "currency"), orgId);
  const label = `asa ${input.group} ${input.action}`;
  const result = await withAppleErrors(label, () => {
    return apiCall(ctx, label, () => runAsaOperation(api, asaApp.id, input, { orgId, currency }));
  });
  printResult(ctx, result.op, result.response);
}
