import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Sandbox } from "@e2b/code-interpreter";
import { z } from "zod";

import type { SandboxConfig } from "./config.js";
import { assertReady } from "./config.js";
import { formatBytes, renderCommandResult, renderDirEntries, renderExecution, truncate } from "./format.js";
import { connectSandbox, createSandbox, describeTarget } from "./sandbox.js";

/** Standard shape of every tool result. */
interface ToolText {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

function ok(text: string): ToolText {
  return { content: [{ type: "text", text }] };
}

function fail(error: unknown, hint?: string): ToolText {
  const err = error as { name?: string; message?: string };
  const name = err?.name ?? "Error";
  const message = err?.message ?? String(error);
  const lines = [`[error] ${name}: ${message}`];
  if (hint) lines.push(hint);
  return { content: [{ type: "text", text: lines.join("\n") }], isError: true };
}

/** Wrap a handler so every failure becomes a readable MCP tool error. */
function guard<Args>(fn: (args: Args) => Promise<ToolText>, hint?: string) {
  return async (args: Args): Promise<ToolText> => {
    try {
      return await fn(args);
    } catch (error) {
      return fail(error, hint);
    }
  };
}

const sandboxIdSchema = z
  .string()
  .min(1)
  .describe("Sandbox ID, e.g. sbx-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (returned by sandbox_create).");

const timeoutSchema = z
  .number()
  .int()
  .positive()
  .optional()
  .describe("Sandbox TTL in milliseconds. Defaults to SANDBOX_TIMEOUT_MS (300000 = 5 minutes).");

const requiredTimeoutSchema = z.number().int().positive().describe("New TTL in milliseconds.");

const codeLanguageSchema = z
  .enum(["python", "javascript", "typescript", "bash", "r", "java"])
  .optional()
  .describe('Execution language, defaults to "python".');

const pathSchema = z.string().min(1).describe("Absolute path inside the sandbox, e.g. /home/user/main.py.");

/**
 * Register every Alibaba Cloud Agent Sandbox tool on the MCP server.
 *
 * Every tool that needs a live sandbox takes an optional `sandbox_id`: when it
 * is omitted the tool creates a throw-away sandbox, runs the operation and
 * kills the sandbox again. Pass `sandbox_id` to reuse a long-lived sandbox
 * across calls (recommended for multi-step work).
 */
export function registerTools(server: McpServer, config: SandboxConfig): void {
  const maxChars = config.maxOutputChars;
  const conn = () => ({ apiKey: config.apiKey, apiUrl: config.apiUrl, domain: config.domain });

  // ---------------------------------------------------------------- status --
  server.registerTool(
    "sandbox_status",
    {
      title: "Check Agent Sandbox configuration",
      description:
        "Show the Alibaba Cloud Agent Sandbox endpoint configuration this server will use (region, domain, API URL, default template) and whether E2B_API_KEY is set. Does not call the network.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guard(async () => ok(describeTarget(config))),
  );

  // ---------------------------------------------------------------- create --
  server.registerTool(
    "sandbox_create",
    {
      title: "Create a sandbox",
      description:
        "Create a new Alibaba Cloud Agent Sandbox (阿里云智能体沙箱) and return its sandbox_id. Keep the ID to reuse the sandbox in later tool calls, and call sandbox_kill when done. Defaults to the code-interpreter-v1 template with a 5 minute TTL.",
      inputSchema: {
        template: z.string().min(1).optional().describe("Template name or ID. Defaults to E2B_TEMPLATE / code-interpreter-v1."),
        timeout_ms: timeoutSchema,
        metadata: z.record(z.string(), z.string()).optional().describe("Free-form key/value metadata stored on the sandbox."),
        envs: z.record(z.string(), z.string()).optional().describe("Environment variables injected into the sandbox."),
      },
      annotations: { openWorldHint: true, destructiveHint: false },
    },
    guard(async ({ template, timeout_ms, metadata, envs }) => {
      const sandbox = await createSandbox(config, {
        ...(template ? { template } : {}),
        ...(timeout_ms ? { timeoutMs: timeout_ms } : {}),
        ...(metadata ? { metadata } : {}),
        ...(envs ? { envs } : {}),
      });
      const info = await Sandbox.getInfo(sandbox.sandboxId, conn());
      return ok(
        [
          `sandbox_id: ${sandbox.sandboxId}`,
          `template:   ${info.templateId}`,
          `state:      ${info.state}`,
          `started_at: ${info.startedAt.toISOString()}`,
          `expires_at: ${info.endAt.toISOString()}`,
          `cpu:        ${info.cpuCount} vCPU`,
          `memory:     ${info.memoryMB} MiB`,
        ].join("\n"),
      );
    }),
  );

  // -------------------------------------------------------------- list/info --
  server.registerTool(
    "sandbox_list",
    {
      title: "List sandboxes",
      description:
        "List sandboxes in the configured region, optionally filtered by state or template. Note: the control-plane list endpoint is eventually consistent, so a sandbox created moments ago may not appear yet.",
      inputSchema: {
        state: z.enum(["running", "paused", "all"]).optional().describe('Filter by state, defaults to "all".'),
        template: z.string().min(1).optional().describe("Only list sandboxes created from this template."),
        limit: z.number().int().min(1).max(100).optional().describe("Maximum number of sandboxes to return (default 20)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ state, template, limit }) => {
      assertReady(config);
      const opts: Record<string, unknown> = { ...conn(), limit: limit ?? 20 };
      const query: Record<string, unknown> = {};
      if (state && state !== "all") query.state = [state];
      if (template) query.template = template;
      if (Object.keys(query).length > 0) opts.query = query;

      const paginator = Sandbox.list(opts as Parameters<typeof Sandbox.list>[0]);
      const items: Array<{ sandboxId: string; templateId: string; state: string; endAt: Date }> = [];
      while (paginator.hasNext && items.length < (limit ?? 20)) {
        const page = await paginator.nextItems();
        items.push(...(page as typeof items));
      }
      if (items.length === 0) return ok("(no sandboxes)");
      const lines = items.map(
        (item) => `${item.sandboxId}  ${item.state.padEnd(8)}  ${item.templateId}  ends ${item.endAt.toISOString()}`,
      );
      return ok(truncate(lines.join("\n"), maxChars).text);
    }),
  );

  server.registerTool(
    "sandbox_info",
    {
      title: "Inspect a sandbox",
      description: "Return state, template, resource size and expiry for one sandbox.",
      inputSchema: { sandbox_id: sandboxIdSchema },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ sandbox_id }) => {
      assertReady(config);
      const info = await Sandbox.getInfo(sandbox_id, conn());
      return ok(
        [
          `sandbox_id: ${info.sandboxId}`,
          `template:   ${info.templateId}`,
          `state:      ${info.state}`,
          `started_at: ${info.startedAt.toISOString()}`,
          `expires_at: ${info.endAt.toISOString()}`,
          `cpu:        ${info.cpuCount} vCPU`,
          `memory:     ${info.memoryMB} MiB`,
          `envd:       ${info.envdVersion}`,
          `metadata:   ${JSON.stringify(info.metadata ?? {})}`,
        ].join("\n"),
      );
    }),
  );

  // ------------------------------------------------------------------- kill --
  server.registerTool(
    "sandbox_kill",
    {
      title: "Kill a sandbox",
      description: "Terminate a sandbox immediately and release its resources. Irreversible.",
      inputSchema: { sandbox_id: sandboxIdSchema },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    guard(async ({ sandbox_id }) => {
      assertReady(config);
      const killed = await Sandbox.kill(sandbox_id, conn());
      return ok(killed ? `killed ${sandbox_id}` : `sandbox ${sandbox_id} was not running`);
    }),
  );

  server.registerTool(
    "sandbox_set_timeout",
    {
      title: "Extend the sandbox TTL",
      description: "Update the time-to-live of a running sandbox so long jobs are not reaped while they run.",
      inputSchema: { sandbox_id: sandboxIdSchema, timeout_ms: requiredTimeoutSchema },
      annotations: { destructiveHint: false, openWorldHint: true },
    },
    guard(async ({ sandbox_id, timeout_ms }) => {
      assertReady(config);
      await Sandbox.setTimeout(sandbox_id, timeout_ms, conn());
      return ok(`sandbox ${sandbox_id} now expires in ${timeout_ms} ms`);
    }),
  );

  // ---------------------------------------------------------------- command --
  server.registerTool(
    "run_command",
    {
      title: "Run a shell command",
      description:
        "Run a shell command inside the sandbox and return stdout, stderr and the exit code. When sandbox_id is omitted a temporary sandbox is created for the call and killed afterwards.",
      inputSchema: {
        command: z.string().min(1).describe('Shell command to run, e.g. "ls -la /home/user".'),
        sandbox_id: sandboxIdSchema.optional().describe("Reuse this sandbox instead of creating a temporary one."),
        cwd: z.string().min(1).optional().describe("Working directory for the command."),
        timeout_ms: timeoutSchema.describe("Sandbox TTL and command timeout in milliseconds."),
        envs: z.record(z.string(), z.string()).optional().describe("Extra environment variables for the command."),
      },
      annotations: { openWorldHint: true, destructiveHint: true },
    },
    guard(async ({ command, sandbox_id, cwd, timeout_ms, envs }) => {
      const owned = sandbox_id === undefined;
      const sandbox = owned
        ? await createSandbox(config, timeout_ms ? { timeoutMs: timeout_ms } : {})
        : await connectSandbox(config, sandbox_id);
      try {
        const result = await sandbox.commands.run(command, {
          ...(cwd ? { cwd } : {}),
          ...(envs ? { envs } : {}),
          ...(timeout_ms ? { timeoutMs: timeout_ms } : {}),
        });
        return ok(renderCommandResult(result, maxChars));
      } finally {
        if (owned) await sandbox.kill().catch(() => undefined);
      }
    }),
  );

  // ------------------------------------------------------------------- code --
  server.registerTool(
    "run_code",
    {
      title: "Execute code in the sandbox",
      description:
        "Execute Python/JavaScript/TypeScript/Bash/R/Java in the sandbox Jupyter kernel and return stdout, stderr, rich results and any error traceback. Requires a code-interpreter template. When sandbox_id is omitted a temporary sandbox is created and killed afterwards.",
      inputSchema: {
        code: z.string().min(1).describe("Source code to execute."),
        language: codeLanguageSchema,
        sandbox_id: sandboxIdSchema.optional().describe("Reuse this sandbox instead of creating a temporary one."),
        timeout_ms: timeoutSchema,
      },
      annotations: { openWorldHint: true, destructiveHint: true },
    },
    guard(async ({ code, language, sandbox_id, timeout_ms }) => {
      const owned = sandbox_id === undefined;
      const sandbox = owned
        ? await createSandbox(config, timeout_ms ? { timeoutMs: timeout_ms } : {})
        : await connectSandbox(config, sandbox_id);
      try {
        const execution = await sandbox.runCode(code, {
          ...(language ? { language } : {}),
          ...(timeout_ms ? { timeoutMs: timeout_ms } : {}),
        });
        return ok(renderExecution(execution, maxChars));
      } finally {
        if (owned) await sandbox.kill().catch(() => undefined);
      }
    }),
  );

  // ------------------------------------------------------------------ files --
  server.registerTool(
    "file_read",
    {
      title: "Read a file",
      description: "Read a text file from the sandbox. Use offset/limit to page through large files.",
      inputSchema: {
        path: pathSchema,
        sandbox_id: sandboxIdSchema.optional(),
        offset: z.number().int().min(0).optional().describe("0-based line offset (default 0)."),
        limit: z.number().int().min(1).max(5000).optional().describe("Maximum number of lines (default 2000)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ path, sandbox_id, offset, limit }) => {
      const owned = sandbox_id === undefined;
      const sandbox = owned ? await createSandbox(config) : await connectSandbox(config, sandbox_id);
      try {
        const raw = await sandbox.files.read(path);
        const lines = raw.split("\n");
        const start = offset ?? 0;
        const count = limit ?? 2000;
        const slice = lines.slice(start, start + count);
        const header = lines.length > count ? `[lines ${start + 1}-${start + slice.length} of ${lines.length}]\n` : "";
        return ok(truncate(header + slice.join("\n"), maxChars).text);
      } finally {
        if (owned) await sandbox.kill().catch(() => undefined);
      }
    }),
  );

  server.registerTool(
    "file_write",
    {
      title: "Write a file",
      description: "Create or overwrite a file inside the sandbox. Parent directories are created automatically.",
      inputSchema: {
        path: pathSchema,
        content: z.string().describe("Full UTF-8 file content."),
        sandbox_id: sandboxIdSchema.optional(),
        append: z.boolean().optional().describe("Append instead of overwriting (implemented as read + write)."),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    guard(async ({ path, content, sandbox_id, append }) => {
      const owned = sandbox_id === undefined;
      const sandbox = owned ? await createSandbox(config) : await connectSandbox(config, sandbox_id);
      try {
        let payload = content;
        if (append) {
          const existing = await sandbox.files.read(path).catch(() => "");
          payload = existing + content;
        }
        const info = await sandbox.files.write(path, payload);
        return ok(`wrote ${formatBytes(Buffer.byteLength(payload))} to ${info.path ?? path}`);
      } finally {
        if (owned) await sandbox.kill().catch(() => undefined);
      }
    }),
  );

  server.registerTool(
    "file_list",
    {
      title: "List a directory",
      description: "List the entries of a directory inside the sandbox with type and size.",
      inputSchema: {
        path: z.string().min(1).describe("Directory path, e.g. /home/user."),
        sandbox_id: sandboxIdSchema.optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ path, sandbox_id }) => {
      const owned = sandbox_id === undefined;
      const sandbox = owned ? await createSandbox(config) : await connectSandbox(config, sandbox_id);
      try {
        const entries = await sandbox.files.list(path);
        return ok(renderDirEntries(entries as never, maxChars));
      } finally {
        if (owned) await sandbox.kill().catch(() => undefined);
      }
    }),
  );

  server.registerTool(
    "file_make_dir",
    {
      title: "Create a directory",
      description: "Create a directory (recursively) inside the sandbox.",
      inputSchema: {
        path: z.string().min(1).describe("Directory path to create."),
        sandbox_id: sandboxIdSchema.optional(),
      },
      annotations: { destructiveHint: false, openWorldHint: true },
    },
    guard(async ({ path, sandbox_id }) => {
      const owned = sandbox_id === undefined;
      const sandbox = owned ? await createSandbox(config) : await connectSandbox(config, sandbox_id);
      try {
        const created = await sandbox.files.makeDir(path);
        return ok(created ? `created ${path}` : `${path} already exists`);
      } finally {
        if (owned) await sandbox.kill().catch(() => undefined);
      }
    }),
  );

  server.registerTool(
    "file_remove",
    {
      title: "Remove a file or directory",
      description: "Delete a file or directory inside the sandbox. Irreversible.",
      inputSchema: {
        path: z.string().min(1).describe("Path to delete."),
        sandbox_id: sandboxIdSchema.optional(),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    guard(async ({ path, sandbox_id }) => {
      const owned = sandbox_id === undefined;
      const sandbox = owned ? await createSandbox(config) : await connectSandbox(config, sandbox_id);
      try {
        await sandbox.files.remove(path);
        return ok(`removed ${path}`);
      } finally {
        if (owned) await sandbox.kill().catch(() => undefined);
      }
    }),
  );

  server.registerTool(
    "file_rename",
    {
      title: "Rename or move a path",
      description: "Rename or move a file or directory inside the sandbox.",
      inputSchema: {
        from: z.string().min(1).describe("Existing path."),
        to: z.string().min(1).describe("New path."),
        sandbox_id: sandboxIdSchema.optional(),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    guard(async ({ from, to, sandbox_id }) => {
      const owned = sandbox_id === undefined;
      const sandbox = owned ? await createSandbox(config) : await connectSandbox(config, sandbox_id);
      try {
        await sandbox.files.rename(from, to);
        return ok(`renamed ${from} -> ${to}`);
      } finally {
        if (owned) await sandbox.kill().catch(() => undefined);
      }
    }),
  );
}
