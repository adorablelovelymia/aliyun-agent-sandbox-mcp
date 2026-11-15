import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { DEFAULT_REGION, DEFAULT_TEMPLATE, loadConfig, readEnvFile } from "../dist/config.js";
import { formatBytes, renderCommandResult, renderExecution, truncate } from "../dist/format.js";

test("loadConfig falls back to the documented Alibaba Cloud defaults", () => {
  const config = loadConfig({});
  assert.equal(config.region, DEFAULT_REGION);
  assert.equal(config.domain, `cn-hangzhou.sandbox.aliyuncs.com`);
  assert.equal(config.apiUrl, `https://api.cn-hangzhou.sandbox.aliyuncs.com`);
  assert.equal(config.template, DEFAULT_TEMPLATE);
  assert.equal(config.apiKey, undefined);
  assert.equal(config.defaultTimeoutMs, 300000);
});

test("loadConfig honours REGION and explicit endpoints", () => {
  const config = loadConfig({ REGION: "cn-beijing", E2B_API_KEY: "e2b_test" });
  assert.equal(config.region, "cn-beijing");
  assert.equal(config.domain, "cn-beijing.sandbox.aliyuncs.com");
  assert.equal(config.apiUrl, "https://api.cn-beijing.sandbox.aliyuncs.com");
  assert.equal(config.apiKey, "e2b_test");

  const overridden = loadConfig({ E2B_DOMAIN: "example.com", E2B_API_URL: "https://api.example.com" });
  assert.equal(overridden.domain, "example.com");
  assert.equal(overridden.apiUrl, "https://api.example.com");
});

test("loadConfig reads a dotenv file and lets real env vars win", () => {
  const dir = mkdtempSync(join(tmpdir(), "aliyun-sandbox-mcp-"));
  const file = join(dir, ".env");
  writeFileSync(file, ['# comment', 'E2B_API_KEY="e2b_from_file"', "REGION=cn-shanghai", ""].join("\n"));

  const parsed = readEnvFile(file);
  assert.equal(parsed.E2B_API_KEY, "e2b_from_file");
  assert.equal(parsed.REGION, "cn-shanghai");

  const config = loadConfig({}, file);
  assert.equal(config.apiKey, "e2b_from_file");
  assert.equal(config.region, "cn-shanghai");

  const overridden = loadConfig({ REGION: "cn-hangzhou" }, file);
  assert.equal(overridden.region, "cn-hangzhou");
  assert.equal(overridden.apiKey, "e2b_from_file");
});

test("readEnvFile ignores a missing file", () => {
  assert.deepEqual(readEnvFile("/definitely/not/here/.env"), {});
});

test("truncate keeps short text untouched", () => {
  const result = truncate("hello", 100);
  assert.equal(result.truncated, false);
  assert.equal(result.text, "hello");
});

test("truncate keeps head and tail of long text", () => {
  const text = `start-${"x".repeat(500)}-end`;
  const result = truncate(text, 120);
  assert.equal(result.truncated, true);
  assert.equal(result.originalLength, text.length);
  assert.ok(result.text.startsWith("start-"));
  assert.ok(result.text.endsWith("-end"));
  assert.ok(result.text.includes("truncated"));
  assert.ok(result.text.length <= 160);
});

test("renderCommandResult labels stderr and the exit code", () => {
  const text = renderCommandResult({ stdout: "hi\n", stderr: "warn\n", exitCode: 3 }, 1000);
  assert.ok(text.includes("hi"));
  assert.ok(text.includes("[stderr]"));
  assert.ok(text.includes("[exitCode: 3]"));
});

test("renderCommandResult reports empty output", () => {
  const text = renderCommandResult({ stdout: "", stderr: "", exitCode: 0 }, 1000);
  assert.ok(text.includes("(no output)"));
});

test("renderExecution renders logs, results and errors", () => {
  const text = renderExecution(
    {
      logs: { stdout: ["2\n"], stderr: ["noise\n"] },
      results: [{ text: "2" }],
      error: { name: "ValueError", value: "boom", traceback: "Traceback: boom" },
    },
    1000,
  );
  assert.ok(text.includes("2"));
  assert.ok(text.includes("[stderr]"));
  assert.ok(text.includes("noise"));
  assert.ok(text.includes("[result 1]"));
  assert.ok(text.includes("ValueError: boom"));
  assert.ok(text.includes("Traceback: boom"));
});

test("formatBytes uses binary units", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2.0 KiB");
  assert.equal(formatBytes(1024 * 1024 * 3), "3.0 MiB");
});
