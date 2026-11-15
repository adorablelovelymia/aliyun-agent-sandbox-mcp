import { Sandbox } from "@e2b/code-interpreter";
import type { SandboxConfig } from "./config.js";
import { assertReady } from "./config.js";

/** Connection options handed to every E2B-compatible call. */
export function connectionOptions(config: SandboxConfig) {
  assertReady(config);
  return {
    apiKey: config.apiKey,
    apiUrl: config.apiUrl,
    domain: config.domain,
  };
}

/** Create a sandbox and return the live handle. */
export async function createSandbox(
  config: SandboxConfig,
  opts: { template?: string; timeoutMs?: number; metadata?: Record<string, string>; envs?: Record<string, string> } = {},
) {
  const conn = connectionOptions(config);
  const template = opts.template ?? config.template;
  return Sandbox.create(template, {
    ...conn,
    timeoutMs: opts.timeoutMs ?? config.defaultTimeoutMs,
    ...(opts.metadata ? { metadata: opts.metadata } : {}),
    ...(opts.envs ? { envs: opts.envs } : {}),
  } as Parameters<typeof Sandbox.create>[1]);
}

/** Reconnect to an existing sandbox (resumes it when paused). */
export async function connectSandbox(config: SandboxConfig, sandboxId: string, timeoutMs?: number) {
  const conn = connectionOptions(config);
  return Sandbox.connect(sandboxId, {
    ...conn,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  } as Parameters<typeof Sandbox.connect>[1]);
}

/** Plain description of the target deployment, safe to print (no secrets). */
export function describeTarget(config: SandboxConfig): string {
  return [
    `region:   ${config.region}`,
    `domain:   ${config.domain}`,
    `apiUrl:   ${config.apiUrl}`,
    `template: ${config.template}`,
    `timeout:  ${config.defaultTimeoutMs} ms`,
    `apiKey:   ${config.apiKey ? "configured" : "missing"}`,
  ].join("\n");
}
