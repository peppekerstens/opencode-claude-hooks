/**
 * Minimal structural types for the OpenCode V2 plugin API.
 *
 * They mirror the parts of `@opencode/plugin` (OpenCode v2.0.29,
 * packages/plugin/src/promise) that this plugin uses. The plugin does not
 * import `@opencode/plugin` at runtime: `Plugin.define` is an identity
 * function, and V2 only checks that the default export has an `id` and a
 * `setup` function.
 */

export interface Registration {
  readonly dispose: () => Promise<void>;
}

export type Hooks<Spec> = <Name extends keyof Spec>(
  name: Name,
  callback: (input: Spec[Name]) => Promise<void> | void
) => Promise<Registration>;

export interface ToolError {
  readonly message: string;
}

export type ToolContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string };

export interface ToolResult {
  readonly output?: unknown;
  readonly content?: string | ReadonlyArray<ToolContent>;
  readonly metadata?: Record<string, unknown>;
}

interface ToolEventBase {
  readonly sessionID: string;
  readonly agent: string;
  readonly messageID: string;
  readonly id: string;
}

export interface ToolHooks {
  readonly "execute.before": ToolEventBase & {
    tool: string;
    input: unknown;
  };
  readonly "execute.after": ToolEventBase & {
    readonly tool: string;
    readonly input: unknown;
  } & (
      | { readonly status: "completed"; result: ToolResult }
      | { readonly status: "error"; error: ToolError }
    );
}

export type PermissionEffect = "allow" | "deny" | "ask";

export interface PermissionHooks {
  readonly evaluate: {
    readonly sessionID: string;
    readonly agent?: string;
    readonly action: string;
    readonly resources: ReadonlyArray<string>;
    readonly metadata?: Record<string, unknown>;
    effect: PermissionEffect;
    message?: string;
  };
}

export interface OpenCodeEvent {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

export interface Context {
  readonly location: { readonly directory: string };
  readonly options: Record<string, unknown>;
  readonly tool: { readonly hook: Hooks<ToolHooks> };
  readonly permission: { readonly hook: Hooks<PermissionHooks> };
  readonly event: {
    readonly subscribe: (options?: { readonly signal?: AbortSignal }) => AsyncIterable<OpenCodeEvent>;
  };
}

export type Cleanup = () => Promise<void> | void;

export interface Plugin {
  readonly id: string;
  readonly setup: (context: Context) => Promise<Cleanup | void> | Cleanup | void;
}
