import { WorkspaceError } from "@/core/workspaces/project";
import type { AgentCredential } from "./outbound";

export const MAX_TOKEN_RENEWALS = 3;

export function createAgentCredential(mint: () => Promise<string>): AgentCredential {
  let latest: string | undefined;
  let first: Promise<string> | undefined;
  let renewing: Promise<string> | undefined;
  let renewals = 0;

  const start = () =>
    mint().then((token) => {
      latest = token;
      return token;
    });

  return {
    current() {
      if (latest !== undefined) return Promise.resolve(latest);
      first ??= start().finally(() => {
        first = undefined;
      });
      return first;
    },
    renew(rejected, { expired = false } = {}) {
      if (renewing) return renewing;
      if (latest !== undefined && latest !== rejected) return Promise.resolve(latest);
      if (!expired && renewals >= MAX_TOKEN_RENEWALS) {
        return Promise.reject(
          new WorkspaceError(
            `The API kept refusing dev's token after ${MAX_TOKEN_RENEWALS} new ones, so it stopped making more. Check \`superwall whoami\`, then restart dev.`,
          ),
        );
      }
      if (!expired) renewals += 1;
      renewing = start().finally(() => {
        renewing = undefined;
      });
      return renewing;
    },
  };
}
