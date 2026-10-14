import type {
  HooksResult,
  PluginContext,
  PostToolUseFailureInput,
  PostToolUseInput,
  PreToolUseInput,
} from "../types";
import { getHooksConfig, getHooksForEvent } from "../config";
import { executeHooks } from "../executor";

/**
 * Handle PreToolUse event (maps to OpenCode tool.execute.before)
 */
export async function handlePreToolUse(
  ctx: PluginContext,
  toolName: string,
  toolInput: Record<string, unknown>,
  matchNames: string[] = [toolName]
): Promise<HooksResult> {
  const config = await getHooksConfig(ctx.cwd);
  const hookConfigs = getHooksForEvent(config, "PreToolUse");

  if (hookConfigs.length === 0) {
    return {
      blocked: false,
      additionalContext: [],
      errors: [],
    };
  }

  const input: PreToolUseInput = {
    session_id: ctx.sessionId,
    transcript_path: ctx.transcriptPath,
    cwd: ctx.cwd,
    permission_mode: ctx.permissionMode,
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: toolInput,
  };

  return executeHooks(hookConfigs, input, ctx.cwd, matchNames);
}

/**
 * Handle PostToolUse event (maps to OpenCode tool.execute.after with success)
 */
export async function handlePostToolUse(
  ctx: PluginContext,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolOutput: string,
  matchNames: string[] = [toolName]
): Promise<HooksResult> {
  const config = await getHooksConfig(ctx.cwd);
  const hookConfigs = getHooksForEvent(config, "PostToolUse");

  if (hookConfigs.length === 0) {
    return {
      blocked: false,
      additionalContext: [],
      errors: [],
    };
  }

  const input: PostToolUseInput = {
    session_id: ctx.sessionId,
    transcript_path: ctx.transcriptPath,
    cwd: ctx.cwd,
    permission_mode: ctx.permissionMode,
    hook_event_name: "PostToolUse",
    tool_name: toolName,
    tool_input: toolInput,
    tool_output: toolOutput,
  };

  return executeHooks(hookConfigs, input, ctx.cwd, matchNames);
}

/**
 * Handle PostToolUseFailure event (maps to OpenCode tool.execute.after with error)
 */
export async function handlePostToolUseFailure(
  ctx: PluginContext,
  toolName: string,
  toolInput: Record<string, unknown>,
  error: string,
  matchNames: string[] = [toolName]
): Promise<HooksResult> {
  const config = await getHooksConfig(ctx.cwd);
  const hookConfigs = getHooksForEvent(config, "PostToolUseFailure");

  if (hookConfigs.length === 0) {
    return {
      blocked: false,
      additionalContext: [],
      errors: [],
    };
  }

  const input: PostToolUseFailureInput = {
    session_id: ctx.sessionId,
    transcript_path: ctx.transcriptPath,
    cwd: ctx.cwd,
    permission_mode: ctx.permissionMode,
    hook_event_name: "PostToolUseFailure",
    tool_name: toolName,
    tool_input: toolInput,
    error,
  };

  return executeHooks(hookConfigs, input, ctx.cwd, matchNames);
}
