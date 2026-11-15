import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Runtime configuration for the Alibaba Cloud Agent Sandbox (阿里云智能体沙箱).
 *
 * The service speaks the E2B protocol, so the connection is described by three
 * environment variables documented by Alibaba Cloud:
 *
 *   export E2B_API_KEY="<YOUR-API-KEY>"
 *   export E2B_API_URL="https://api.<region>.sandbox.aliyuncs.com"
 *   export E2B_DOMAIN="<region>.sandbox.aliyuncs.com"
 *
 * @see https://help.aliyun.com/zh/agent-sandbox/using-the-cloud-sandbox-via-the-sdk
 */
export interface SandboxConfig {
  /** E2B-compatible API key issued by the Agent Sandbox console. */
  apiKey: string | undefined;
  /** Region, e.g. `cn-hangzhou`. */
  region: string;
  /** Sandbox domain, e.g. `cn-hangzhou.sandbox.aliyuncs.com`. */
  domain: string;
  /** Control-plane API base URL, e.g. `https://api.cn-hangzhou.sandbox.aliyuncs.com`. */
  apiUrl: string;
  /** Default template used when a tool call does not pass one. */
  template: string;
  /** Default sandbox TTL in milliseconds. */
  defaultTimeoutMs: number;
  /** Maximum number of characters any single tool result may contain. */
  maxOutputChars: number;
}

export const DEFAULT_REGION = "cn-hangzhou";
export const DEFAULT_TEMPLATE = "code-interpreter-v1";
export const DEFAULT_TIMEOUT_MS = 300_000;
export const DEFAULT_MAX_OUTPUT_CHARS = 30_000;

type Env = Record<string, string | undefined>;

function str(env: Env, key: string): string | undefined {
  const value = env[key];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function int(env: Env, key: string, fallback: number): number {
  const raw = str(env, key);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Read a dotenv-style file (`KEY=value`, `#` comments, optional quotes).
 * Missing files are ignored so the caller can chain several candidate paths.
 */
export function readEnvFile(path: string): Env {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  const out: Env = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Load configuration from the process environment, with an optional dotenv file.
 *
 * Precedence: explicit env vars > dotenv file > defaults.
 */
export function loadConfig(env: Env = process.env, envFile?: string): SandboxConfig {
  const file = envFile ?? str(env, "SANDBOX_ENV_FILE");
  const fromFile: Env = file ? readEnvFile(file) : {};
  const merged: Env = { ...fromFile, ...env };

  const region = str(merged, "REGION") ?? str(merged, "E2B_REGION") ?? DEFAULT_REGION;
  const domain = str(merged, "E2B_DOMAIN") ?? `${region}.sandbox.aliyuncs.com`;
  const apiUrl = str(merged, "E2B_API_URL") ?? `https://api.${region}.sandbox.aliyuncs.com`;

  return {
    apiKey: str(merged, "E2B_API_KEY"),
    region,
    domain,
    apiUrl,
    template: str(merged, "E2B_TEMPLATE") ?? DEFAULT_TEMPLATE,
    defaultTimeoutMs: int(merged, "SANDBOX_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
    maxOutputChars: int(merged, "SANDBOX_MAX_OUTPUT_CHARS", DEFAULT_MAX_OUTPUT_CHARS),
  };
}

/** Candidate dotenv locations checked when no explicit file is configured. */
export function defaultEnvFileCandidates(cwd: string = process.cwd()): string[] {
  return [join(cwd, ".env"), join(homedir(), ".aliyun-agent-sandbox-mcp", ".env")];
}

/** Throw a friendlier error than the SDK's when the API key is missing. */
export function assertReady(config: SandboxConfig): void {
  if (config.apiKey) return;
  throw new Error(
    [
      "缺少环境变量 E2B_API_KEY / Missing environment variable E2B_API_KEY.",
      "请在阿里云 Agent Sandbox 控制台创建 API Key 后配置：",
      '  export E2B_API_KEY="<YOUR-API-KEY>"',
      `  export REGION="${config.region}"`,
      "也可以在 .env 文件中设置，或通过 SANDBOX_ENV_FILE 指向一个 dotenv 文件。",
    ].join("\n"),
  );
}
