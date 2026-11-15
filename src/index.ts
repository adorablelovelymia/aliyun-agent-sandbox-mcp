#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";
import { registerTools } from "./tools.js";
import { describeTarget } from "./sandbox.js";

export const SERVER_NAME = "aliyun-agent-sandbox-mcp";
export const SERVER_VERSION = "0.1.0";

const HELP = `${SERVER_NAME} ${SERVER_VERSION}

MCP server for Alibaba Cloud Agent Sandbox (阿里云智能体沙箱).

Usage:
  aliyun-agent-sandbox-mcp              Start the MCP server over stdio
  aliyun-agent-sandbox-mcp --check      Validate configuration and exit
  aliyun-agent-sandbox-mcp --help       Show this help
  aliyun-agent-sandbox-mcp --version    Print the version

Environment:
  E2B_API_KEY              API key from the Agent Sandbox console (required)
  REGION                   Region, e.g. cn-hangzhou (default: cn-hangzhou)
  E2B_DOMAIN               Sandbox domain   (default: <region>.sandbox.aliyuncs.com)
  E2B_API_URL              API base URL     (default: https://api.<region>.sandbox.aliyuncs.com)
  E2B_TEMPLATE             Default template (default: code-interpreter-v1)
  SANDBOX_TIMEOUT_MS       Default sandbox TTL in ms (default: 300000)
  SANDBOX_MAX_OUTPUT_CHARS Max characters per tool result (default: 30000)
  SANDBOX_ENV_FILE         Path to a dotenv file with the values above

Docs: https://help.aliyun.com/zh/agent-sandbox/using-the-cloud-sandbox-via-the-sdk
`;

/** Build the MCP server with all tools registered. */
export function createServer(envFile?: string): McpServer {
  const config = loadConfig(process.env, envFile);
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions: [
        "This server exposes Alibaba Cloud Agent Sandbox (阿里云智能体沙箱) - secure, ephemeral Linux sandboxes in the cloud.",
        "Typical flow: call sandbox_create to get a sandbox_id, then run_command / run_code / file_* with that sandbox_id, and sandbox_kill when done.",
        "Tools that accept an optional sandbox_id create and destroy a temporary sandbox per call when it is omitted.",
      ].join("\n"),
    },
  );
  registerTools(server, config);
  return server;
}

/** Entry point used by the bin shim. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = new Set(argv);

  if (args.has("--help") || args.has("-h")) {
    process.stdout.write(HELP);
    return;
  }
  if (args.has("--version") || args.has("-v")) {
    process.stdout.write(`${SERVER_VERSION}\n`);
    return;
  }
  if (args.has("--check")) {
    const config = loadConfig(process.env);
    process.stdout.write(`${describeTarget(config)}\n`);
    if (!config.apiKey) {
      process.stderr.write("E2B_API_KEY is not configured.\n");
      process.exitCode = 1;
    }
    return;
  }

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * True when this file is the process entry point.
 *
 * Compares resolved paths instead of raw strings because npm installs the bin
 * as a symlink (`node_modules/.bin/x -> ../pkg/dist/index.js`), so
 * `process.argv[1]` is the link while `import.meta.url` is the real file.
 */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().catch((error) => {
    const detail = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${SERVER_NAME} failed to start: ${detail}\n`);
    process.exit(1);
  });
}
