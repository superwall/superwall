import { basename } from "node:path";
import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { VERSION } from "@/constants";
import {
  getHostedAnthropicBaseUrl,
  getHostedAuthToken,
  getHostedStatus,
} from "@/core/agent/hosted";
import type { AgentDriver, AgentEvent, AgentResult, AgentRunOptions, DriverInfo } from "./types";
import { isUsageLimitText } from "./limits";
import { toolsForCapabilities } from "./capabilities";

const SDK_MODEL_ALIAS = "claude-sonnet-5";

function toolSummary(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  if (typeof i.file_path === "string") return `${name} ${basename(i.file_path)}`;
  if (typeof i.command === "string") return `${name}: ${String(i.command).slice(0, 60)}`;
  if (typeof i.pattern === "string") return `${name} ${i.pattern}`;
  return name;
}

function extractStatus(text: string): string | undefined {
  const m = text.match(/\[STATUS\]\s*(.+?)\s*$/m);
  return m?.[1]?.trim();
}

function emitAssistant(message: unknown, onEvent?: (e: AgentEvent) => void): void {
  if (!onEvent) return;
  const content = (message as { content?: unknown })?.content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block?.type === "text" && typeof block.text === "string") {
      const status = extractStatus(block.text);
      if (status) onEvent({ type: "status", text: status });
      else if (block.text.trim()) onEvent({ type: "text", text: block.text.trim() });
    } else if (block?.type === "tool_use" && typeof block.name === "string") {
      onEvent({
        type: "tool",
        name: block.name,
        summary: toolSummary(block.name, block.input),
      });
    }
  }
}

function resultText(message: SDKMessage): string | undefined {
  if (message.type !== "result") return undefined;
  if ("result" in message && typeof message.result === "string") return message.result;
  if ("errors" in message && Array.isArray(message.errors)) return message.errors.join("\n");
  return undefined;
}

function buildEnv(token: string): Options["env"] {
  return {
    ...process.env,
    ANTHROPIC_BASE_URL: getHostedAnthropicBaseUrl(),
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

async function getRunAuth(): Promise<{ ok: true; token: string } | { ok: false; message: string }> {
  const token = await getHostedAuthToken();
  if (!token) {
    return {
      ok: false,
      message: "Sign in with `superwall login` to use the bundled Superwall Agent.",
    };
  }

  const status = await getHostedStatus();
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

export const superwallDriver: AgentDriver = {
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
    const auth = await getRunAuth();
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
        env: buildEnv(auth.token),
        stderr: () => {},
      };

      for await (const message of query({ prompt: opts.prompt, options })) {
        if (message.type === "assistant") {
          emitAssistant(message.message, opts.onEvent);
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
