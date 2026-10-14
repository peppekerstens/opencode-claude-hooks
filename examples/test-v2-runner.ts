/**
 * Manual test runner for the OpenCode V2 entry point.
 * It calls the V2 setup function with a fake context and checks that
 * the tool hooks block, pass and give context as expected.
 * Run with: bun run examples/test-v2-runner.ts
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import plugin from "../src/v2/index";
import { clearConfigCache } from "../src/config";

const dir = mkdtempSync(join(tmpdir(), "claude-hooks-v2-"));
mkdirSync(join(dir, ".opencode"));
const log = join(dir, "post.log");
writeFileSync(
  join(dir, ".opencode", "hooks.json"),
  JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: `grep -q 'rm -rf' && { echo "rm -rf is not allowed" >&2; exit 2; } || exit 0`,
              timeout: 5000,
            },
          ],
        },
        {
          matcher: "read",
          hooks: [
            {
              type: "command",
              command: `echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"no reads"}}'`,
              timeout: 5000,
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: "*",
          hooks: [
            {
              type: "command",
              command: `cat >> ${log}; echo; echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"post hook ran"}}'`,
              timeout: 5000,
            },
          ],
        },
      ],
    },
  })
);

type Callback = (event: any) => Promise<void> | void;
const hooks = new Map<string, Callback>();
const register = (domain: string) => async (name: string, callback: Callback) => {
  hooks.set(`${domain}.${name}`, callback);
  return { dispose: async () => {} };
};

const ctx = {
  location: { directory: dir },
  options: {},
  tool: { hook: register("tool") },
  permission: { hook: register("permission") },
  event: {
    subscribe: () => ({
      async *[Symbol.asyncIterator]() {},
    }),
  },
};

let failures = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}

clearConfigCache();
const cleanup = await plugin.setup(ctx as any);
check("plugin id", plugin.id === "opencode-claude-hooks");
check("tool hooks registered", hooks.has("tool.execute.before") && hooks.has("tool.execute.after"));

const base = { sessionID: "ses_test", agent: "build", messageID: "msg_test", id: "call_test" };
const before = hooks.get("tool.execute.before")!;
const after = hooks.get("tool.execute.after")!;

// Exit code 2 blocks the shell tool (matcher "Bash" matches the V2 tool "shell")
let error: unknown;
try {
  await before({ ...base, tool: "shell", input: { command: "rm -rf /tmp/x" } });
} catch (err) {
  error = err;
}
check("exit code 2 blocks shell", error instanceof Error && error.message.includes("rm -rf is not allowed"));

// A safe command passes
error = undefined;
try {
  await before({ ...base, tool: "shell", input: { command: "echo hi" } });
} catch (err) {
  error = err;
}
check("safe shell command passes", error === undefined);

// A JSON deny decision with exit code 0 blocks (matcher uses the V2 name "read")
error = undefined;
try {
  await before({ ...base, tool: "read", input: { path: "a.txt" } });
} catch (err) {
  error = err;
}
check("JSON permissionDecision deny blocks", error instanceof Error && error.message === "no reads");

// PostToolUse gets tool name, input and output, and its additionalContext reaches the result
const event = {
  ...base,
  tool: "shell",
  input: { command: "echo hi" },
  status: "completed",
  result: { content: [{ type: "text", text: "hi" }] },
};
await after(event);
const logged = existsSync(log) ? JSON.parse(readFileSync(log, "utf-8").trim()) : {};
check("PostToolUse hook ran", logged.hook_event_name === "PostToolUse");
check("PostToolUse got Claude tool name", logged.tool_name === "Bash");
check("PostToolUse got tool input", logged.tool_input?.command === "echo hi");
check("PostToolUse got tool output", logged.tool_output === "hi");
check(
  "additionalContext added to result",
  JSON.stringify(event.result.content).includes("post hook ran")
);

if (typeof cleanup === "function") await cleanup();
console.log(failures === 0 ? "\nAll V2 checks passed" : `\n${failures} V2 check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
