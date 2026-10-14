/**
 * OpenCode V2 Plugin: Claude Code Hooks Compatibility
 *
 * OpenCode V2 does not run V1 plugins. A V2 plugin default-exports
 * `{ id, setup(ctx) }` and registers hooks on each domain in `setup`.
 * This entry point reuses the shared handlers, config loader and executor.
 */

import type { HooksResult, PluginContext } from "../types";
import { handleSessionStart, handleSessionEnd } from "../handlers/session";
import { handlePreToolUse, handlePostToolUse, handlePostToolUseFailure } from "../handlers/tool";
import { handlePermissionRequest } from "../handlers/permission";
import { handleSubagentStart, handleSubagentStop } from "../handlers/subagent";
import type { Context, OpenCodeEvent, Plugin, ToolResult } from "./types";

/**
 * OpenCode V2 tool names mapped to Claude Code tool names.
 *
 * Hooks receive the Claude Code name in `tool_name`, so hook scripts written
 * for Claude Code work unchanged. A `matcher` matches when it matches either
 * the Claude Code name or the OpenCode name.
 */
export const CLAUDE_TOOL_NAMES: Readonly<Record<string, string>> = {
  shell: "Bash",
  read: "Read",
  write: "Write",
  edit: "Edit",
  patch: "Edit",
  glob: "Glob",
  grep: "Grep",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  subagent: "Task",
  skill: "Skill",
};

export function toolNames(tool: string): { name: string; matchNames: string[] } {
  const claudeName = CLAUDE_TOOL_NAMES[tool];
  if (!claudeName) return { name: tool, matchNames: [tool] };
  return { name: claudeName, matchNames: [claudeName, tool] };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Plain text of a V2 tool result, for `tool_output` */
export function resultText(result: ToolResult): string {
  const { content, output } = result;
  if (typeof content === "string") return content;
  if (Array.isArray(content) && content.length > 0) {
    return content
      .map((part) => (part.type === "text" ? part.text : `[file ${part.name ?? part.uri}]`))
      .join("\n");
  }
  if (output === undefined) return "";
  return typeof output === "string" ? output : JSON.stringify(output);
}

/** Reason to block a tool call, or undefined to let it run */
export function blockReason(result: HooksResult): string | undefined {
  if (result.blocked) return result.blockReason?.trim() || "Blocked by a PreToolUse hook";
  // Claude Code also accepts a deny decision in the JSON output with exit code 0
  if (result.permissionDecision === "deny") {
    return result.permissionDecisionReason?.trim() || "Denied by a PreToolUse hook";
  }
  return undefined;
}

function eventSessionId(event: OpenCodeEvent): string | undefined {
  const data = asRecord(event.data);
  const id = data.sessionID ?? data.id;
  return typeof id === "string" ? id : undefined;
}

export function createPlugin(): Plugin {
  return {
    id: "opencode-claude-hooks",
    async setup(ctx: Context) {
      const projectDir = ctx.location?.directory || process.cwd();
      const sessionContexts = new Map<string, PluginContext>();

      const getOrCreateContext = (sessionId: string): PluginContext => {
        let pluginCtx = sessionContexts.get(sessionId);
        if (!pluginCtx) {
          pluginCtx = { sessionId, cwd: projectDir, permissionMode: "default", transcriptPath: "" };
          sessionContexts.set(sessionId, pluginCtx);
        }
        return pluginCtx;
      };

      await ctx.tool.hook("execute.before", async (event) => {
        let reason: string | undefined;
        try {
          const pluginCtx = getOrCreateContext(event.sessionID);
          const toolInput = asRecord(event.input);
          const { name, matchNames } = toolNames(event.tool);

          if (name === "Task") {
            const subagentType = typeof toolInput.agent === "string" ? toolInput.agent : "unknown";
            const description = typeof toolInput.description === "string" ? toolInput.description : "";
            const subagentResult = await handleSubagentStart(pluginCtx, subagentType, description);
            reason = subagentResult.blocked
              ? subagentResult.blockReason?.trim() || "Blocked by a SubagentStart hook"
              : undefined;
          }

          if (reason === undefined) {
            const result = await handlePreToolUse(pluginCtx, name, toolInput, matchNames);
            reason = blockReason(result);
            if (reason === undefined && result.updatedInput) {
              event.input = { ...toolInput, ...result.updatedInput };
            }
          }
        } catch (err) {
          // A broken hook must not stop the tool call
          return;
        }
        // V2 rejects the tool call when an execute.before hook throws
        if (reason !== undefined) throw new Error(reason);
      });

      await ctx.tool.hook("execute.after", async (event) => {
        try {
          const pluginCtx = getOrCreateContext(event.sessionID);
          const toolInput = asRecord(event.input);
          const { name, matchNames } = toolNames(event.tool);

          if (event.status === "error") {
            if (name === "Task") {
              await handleSubagentStop(pluginCtx, String(toolInput.agent ?? "unknown"), String(toolInput.description ?? ""), event.error.message);
            }
            await handlePostToolUseFailure(pluginCtx, name, toolInput, event.error.message, matchNames);
            return;
          }

          const output = resultText(event.result);
          if (name === "Task") {
            await handleSubagentStop(pluginCtx, String(toolInput.agent ?? "unknown"), String(toolInput.description ?? ""), output);
          }
          const result = await handlePostToolUse(pluginCtx, name, toolInput, output, matchNames);

          // Give additionalContext from PostToolUse hooks to the model, as Claude Code does
          const extra = (result.additionalContext ?? []).filter((text) => text.trim().length > 0);
          if (extra.length > 0) {
            const content = event.result.content;
            const parts = typeof content === "string"
              ? [{ type: "text" as const, text: content }]
              : Array.isArray(content) && content.length > 0
                ? [...content]
                : output
                  ? [{ type: "text" as const, text: output }]
                  : [];
            event.result = {
              ...event.result,
              content: [...parts, ...extra.map((text) => ({ type: "text" as const, text }))],
            };
          }
        } catch (err) {
          // ignore
        }
      });

      await ctx.permission.hook("evaluate", async (event) => {
        try {
          // An explicit deny is final in V2 and does not reach this hook
          const pluginCtx = getOrCreateContext(event.sessionID);
          const { name } = toolNames(event.action);
          const result = await handlePermissionRequest(
            pluginCtx,
            name,
            { resources: [...event.resources], ...(event.metadata ?? {}) },
            event.action
          );
          if (result.permissionDecision === "allow") {
            event.effect = "allow";
          } else if (result.permissionDecision === "deny" || result.blocked) {
            event.effect = "deny";
            event.message = result.permissionDecisionReason ?? result.blockReason ?? "Denied by a PermissionRequest hook";
          }
        } catch (err) {
          // ignore
        }
      });

      // Session lifecycle events run in the background until the plugin unloads
      const abort = new AbortController();
      void (async () => {
        try {
          for await (const event of ctx.event.subscribe({ signal: abort.signal })) {
            try {
              if (event.type === "session.created") {
                const sessionId = eventSessionId(event) ?? "unknown";
                await handleSessionStart(getOrCreateContext(sessionId), false);
              } else if (event.type === "session.deleted") {
                const sessionId = eventSessionId(event) ?? "unknown";
                const pluginCtx = sessionContexts.get(sessionId);
                if (pluginCtx) {
                  await handleSessionEnd(pluginCtx);
                  sessionContexts.delete(sessionId);
                }
              }
            } catch (err) {
              // ignore
            }
          }
        } catch (err) {
          // The stream ends when the plugin unloads
        }
      })();

      return () => {
        abort.abort();
      };
    },
  };
}

const ClaudeCodeHooksPlugin: Plugin = createPlugin();

export default ClaudeCodeHooksPlugin;
