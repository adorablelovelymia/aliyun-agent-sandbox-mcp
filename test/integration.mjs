#!/usr/bin/env node
/**
 * End-to-end test against a real Alibaba Cloud Agent Sandbox.
 *
 *   E2B_API_KEY=... REGION=cn-hangzhou node test/integration.mjs
 *
 * It drives the built MCP server over stdio exactly like a real MCP client.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const apiKey = process.env.E2B_API_KEY;
if (!apiKey) {
  console.error("E2B_API_KEY is required to run the integration test.");
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  env: { ...process.env, E2B_API_KEY: apiKey },
});
const client = new Client({ name: "integration-test", version: "0.0.0" });
await client.connect(transport);

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}`);
    if (detail !== undefined) console.log(`       ${String(detail).split("\n").join("\n       ")}`);
  }
}

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  return (result.content ?? []).map((part) => part.text ?? "").join("\n");
}

try {
  const { tools } = await client.listTools();
  console.log(`Discovered ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}\n`);

  const status = await call("sandbox_status");
  check("sandbox_status reports the endpoint", status.includes("cn-hangzhou.sandbox.aliyuncs.com"), status);
  check("sandbox_status sees the API key", status.includes("configured"), status);

  const created = await call("sandbox_create", { timeout_ms: 300000 });
  const sandboxId = /sandbox_id: (\S+)/.exec(created)?.[1];
  check("sandbox_create returns an id", Boolean(sandboxId), created);
  console.log(`  sandbox: ${sandboxId}\n`);

  const info = await call("sandbox_info", { sandbox_id: sandboxId });
  check("sandbox_info reports running", info.includes("state:      running"), info);

  const listed = await call("sandbox_list", { limit: 5 });
  check("sandbox_list contains the new sandbox", listed.includes(sandboxId), listed);

  const command = await call("run_command", { sandbox_id: sandboxId, command: "python3 -c \"print(6*7)\"" });
  check("run_command runs a shell command", command.includes("42") && command.includes("[exitCode: 0]"), command);

  const code = await call("run_code", { sandbox_id: sandboxId, code: "print(sum(range(10)))" });
  check("run_code runs Python in the kernel", code.includes("45"), code);

  const js = await call("run_code", { sandbox_id: sandboxId, language: "javascript", code: "console.log([1,2,3].reduce((a,b)=>a+b))" });
  check("run_code runs JavaScript", js.includes("6"), js);

  const write = await call("file_write", { sandbox_id: sandboxId, path: "/home/user/notes/hello.txt", content: "hello sandbox\n" });
  check("file_write writes a file", write.toLowerCase().includes("wrote"), write);

  const read = await call("file_read", { sandbox_id: sandboxId, path: "/home/user/notes/hello.txt" });
  check("file_read reads it back", read.includes("hello sandbox"), read);

  const dir = await call("file_list", { sandbox_id: sandboxId, path: "/home/user/notes" });
  check("file_list lists the directory", dir.includes("hello.txt"), dir);

  const renamed = await call("file_rename", { sandbox_id: sandboxId, from: "/home/user/notes/hello.txt", to: "/home/user/notes/bye.txt" });
  check("file_rename renames the file", renamed.includes("bye.txt"), renamed);

  const removed = await call("file_remove", { sandbox_id: sandboxId, path: "/home/user/notes/bye.txt" });
  check("file_remove deletes the file", removed.includes("removed"), removed);

  const killed = await call("sandbox_kill", { sandbox_id: sandboxId });
  check("sandbox_kill terminates it", killed.includes("killed"), killed);

  const ephemeral = await call("run_command", { command: "echo ephemeral-ok" });
  check("temporary sandbox path works without sandbox_id", ephemeral.includes("ephemeral-ok"), ephemeral);
} catch (error) {
  failures += 1;
  console.error("integration test crashed:", error);
} finally {
  await client.close().catch(() => undefined);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
