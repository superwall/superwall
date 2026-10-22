import { query, type Options, type SDKMessage, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { resolveHostedAnthropicBaseUrl, selectHostedStatus } from "@/core/workflows/agent/hosted";
import { getOAuthAccessToken } from "@/core/account/token";
import { VERSION } from "@/environment";
import { toolsForCapabilities } from "./capabilities";
import { emitAssistantEvents } from "./events";
import { isUsageLimitText } from "./limits";
import type { AgentDriver, AgentResult, AgentRunOptions, DriverInfo } from "./types";

const SDK_MODEL_ALIAS = "claude-sonnet-5";

function resultText(message: SDKResultMessage): string | undefined {
  if ("result" in message && typeof message.result === "string") return message.result;
  if ("errors" in message && Array.isArray(message.errors)) return message.errors.join("\n");
  return undefined;
}

function resolveHostedEnv(token: string): Options["env"] {
  return {
    ...process.env,
    ANTHROPIC_BASE_URL: resolveHostedAnthropicBaseUrl(),
    ANTHROPIC_AUTH_TOKEN: token,
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_MODEL: SDK_MODEL_ALIAS,
    ANTHROPIC_DEFAULT_SONNET_MODEL: SDK_MODEL_ALIAS,
    ANTHROPIC_DEFAULT_OPUS_MODEL: SDK_MODEL_ALIAS,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: SDK_MODEL_ALIAS,
    CLAUDE_CODE_SUBAGENT_MODEL: SDK_MODEL_ALIAS,
    CLAUDE_AGENT_SDK_CLIENT_APP: `superwall-cli/${VERSION}`,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CODE_MAX_RETRIES: "2",
  };
}

async function resolveRunAuth(): Promise<{ ok: true; token: string } | { ok: false; message: string }> {
  const token = await getOAuthAccessToken();
  if (!token) {
    return {
      ok: false,
      message: "Sign in with `superwall login` to use the bundled Superwall Agent.",
    };
  }

  const status = await selectHostedStatus();
  if (!status) {
    return {
      ok: false,
      message: "The hosted Superwall Agent is unavailable right now.",
    };
  }
  if (status.exhausted) {
    return {
      ok: false,
      message: "Your hosted Superwall Agent credit is exhausted.",
    };
  }

  return { ok: true, token };
}

type RunQuery = (params: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

export function createSuperwallDriver(runQuery: RunQuery): AgentDriver {
  return {
    id: "superwall",
    displayName: "Superwall Agent",

    async detect(): Promise<DriverInfo | null> {
      return {
        id: "superwall",
        displayName: "Superwall Agent",
        bin: "claude-agent-sdk",
      };
    },

    async run(opts: AgentRunOptions): Promise<AgentResult> {
      const auth = await resolveRunAuth();
      if (!auth.ok) {
        opts.onEvent?.({ type: "error", message: auth.message });
        return {
          ok: false,
          finalText: auth.message,
          failureReason: isUsageLimitText(auth.message) ? "usage-limit" : undefined,
        };
      }

      const abortController = new AbortController();
      const onAbort = () => abortController.abort(opts.signal?.reason);
      if (opts.signal?.aborted) onAbort();
      else opts.signal?.addEventListener("abort", onAbort, { once: true });

      let finalText: string | undefined;
      let ok = false;

      try {
        const options: Options = {
          abortController,
          cwd: opts.cwd,
          tools: { type: "preset", preset: "claude_code" },
          allowedTools: toolsForCapabilities(opts.capabilities),
          disallowedTools:
            opts.capabilities.filesystem === "read"
              ? ["Write", "Edit", "MultiEdit", "NotebookEdit"]
              : undefined,
          permissionMode: opts.capabilities.filesystem === "read" ? "plan" : "acceptEdits",
          systemPrompt: opts.systemAppend
            ? { type: "preset", preset: "claude_code", append: opts.systemAppend }
            : { type: "preset", preset: "claude_code" },
          model: SDK_MODEL_ALIAS,
          settingSources: [],
          strictMcpConfig: true,
          persistSession: false,
          env: resolveHostedEnv(auth.token),
          stderr: () => {},
        };

        for await (const message of runQuery({ prompt: opts.prompt, options })) {
          if (message.type === "assistant") {
            emitAssistantEvents(message.message, opts.onEvent);
          } else if (message.type === "result") {
            finalText = resultText(message);
            ok = message.subtype === "success" && message.is_error !== true;
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        opts.onEvent?.({ type: "error", message });
        return {
          ok: false,
          finalText: message,
          failureReason: isUsageLimitText(message) ? "usage-limit" : undefined,
        };
      } finally {
        opts.signal?.removeEventListener("abort", onAbort);
      }

      return {
        finalText,
        ok,
        failureReason: !ok && isUsageLimitText(finalText) ? "usage-limit" : undefined,
      };
    },
  };
}

export const superwallDriver = createSuperwallDriver(query);
