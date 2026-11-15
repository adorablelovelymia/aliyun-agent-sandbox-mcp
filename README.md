# aliyun-agent-sandbox-mcp

[![npm](https://img.shields.io/npm/v/aliyun-agent-sandbox-mcp.svg)](https://www.npmjs.com/package/aliyun-agent-sandbox-mcp)
[![license](https://img.shields.io/npm/l/aliyun-agent-sandbox-mcp.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/aliyun-agent-sandbox-mcp.svg)](https://nodejs.org)

**阿里云智能体沙箱（Agent Sandbox）的 MCP Server** —— 让 Claude、Cursor、Cline、DeepSeek Harness 等支持
[Model Context Protocol](https://modelcontextprotocol.io) 的 AI 客户端，直接在自己的对话里创建云端沙箱、
执行 Shell 命令、跑 Python / JavaScript 代码、读写文件。

阿里云 Agent Sandbox 极速版兼容 [E2B](https://e2b.dev) 协议，因此本项目的连接层直接复用官方
`e2b` / `@e2b/code-interpreter` SDK，只把 **Endpoint 换成阿里云地域域名**，并在其上封装出一层贴合
大模型调用习惯的 MCP 工具。

> 官方文档：<https://help.aliyun.com/zh/agent-sandbox/using-the-cloud-sandbox-via-the-sdk>

---

## 特性

- **14 个 MCP 工具**：沙箱生命周期、命令执行、代码解释器、文件系统全覆盖
- **两种使用模式**：显式 `sandbox_id` 复用长生命周期沙箱，或省略 `sandbox_id` 每次调用自动创建 / 销毁临时沙箱
- **多语言代码执行**：Python / JavaScript / TypeScript / Bash / R / Java（依赖 `code-interpreter-v1` 模板）
- **零硬编码**：全部走环境变量或 `.env` 文件，不会把 API Key 写进代码
- **输出有界**：单次工具返回超长时自动截断（头 + 尾保留），避免撑爆上下文
- **仅需 Node.js ≥ 20.18.1**，通过 `npx` 零安装运行
- **TypeScript** 编写，带类型声明与单元测试

## 工具一览

| 工具 | 说明 |
| --- | --- |
| `sandbox_status` | 打印当前 Endpoint 配置与 API Key 是否就绪（不联网） |
| `sandbox_create` | 创建沙箱，返回 `sandbox_id` |
| `sandbox_list` | 按状态 / 模板列出沙箱 |
| `sandbox_info` | 查看单个沙箱状态、规格与到期时间 |
| `sandbox_set_timeout` | 延长沙箱 TTL |
| `sandbox_kill` | 销毁沙箱，释放资源 |
| `run_command` | 在沙箱内执行 Shell 命令，返回 stdout / stderr / exitCode |
| `run_code` | 在 Jupyter 内核里执行代码，返回日志、富结果与 traceback |
| `file_read` | 读取文本文件，支持 `offset` / `limit` 分页 |
| `file_write` | 写入文件（自动建父目录，可选追加） |
| `file_list` | 列出目录内容（类型 + 大小） |
| `file_make_dir` | 递归创建目录 |
| `file_rename` | 重命名 / 移动文件或目录 |
| `file_remove` | 删除文件或目录 |

## 快速开始

### 1. 准备阿里云侧资源

按官方文档依次完成：

1. [配置 RAM 用户权限](https://help.aliyun.com/zh/agent-sandbox/configure-ram-user-permissions)
2. [创建 Team](https://help.aliyun.com/zh/agent-sandbox/create-team)
3. [创建 API Key](https://help.aliyun.com/zh/agent-sandbox/create-api-key)（形如 `e2b_xxx`）

并确认目标地域已开通 Agent Sandbox 极速版。

### 2. 配置环境变量

```bash
export E2B_API_KEY="e2b_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export REGION="cn-hangzhou"          # 可选，默认 cn-hangzhou
```

`E2B_DOMAIN` 与 `E2B_API_URL` 默认由 `REGION` 推导：

| 变量 | 默认值 |
| --- | --- |
| `E2B_DOMAIN` | `<region>.sandbox.aliyuncs.com` |
| `E2B_API_URL` | `https://api.<region>.sandbox.aliyuncs.com` |

需要自定义时再显式设置：

```bash
export E2B_DOMAIN="cn-hangzhou.sandbox.aliyuncs.com"
export E2B_API_URL="https://api.cn-hangzhou.sandbox.aliyuncs.com"
```

### 3. 自检

```bash
npx -y aliyun-agent-sandbox-mcp --check
```

输出示例：

```text
region:   cn-hangzhou
domain:   cn-hangzhou.sandbox.aliyuncs.com
apiUrl:   https://api.cn-hangzhou.sandbox.aliyuncs.com
template: code-interpreter-v1
timeout:  300000 ms
apiKey:   configured
```

## 接入 MCP 客户端

### Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "aliyun-agent-sandbox": {
      "command": "npx",
      "args": ["-y", "aliyun-agent-sandbox-mcp"],
      "env": {
        "E2B_API_KEY": "e2b_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "REGION": "cn-hangzhou"
      }
    }
  }
}
```

### Cursor / Cline / Continue

同上，把 `mcpServers` 片段写进各自配置（Cursor：`~/.cursor/mcp.json`）。

### 从源码运行

```bash
git clone https://github.com/adorablelovelymia/aliyun-agent-sandbox-mcp.git
cd aliyun-agent-sandbox-mcp
npm install
npm run build
node dist/index.js --check
```

然后把 `command` 换成 `node`，`args` 换成 `["/绝对路径/dist/index.js"]`。

## 使用示例（对话里可以直接这样说）

> 帮我创建一个沙箱，在里面跑一下这段 pandas 代码，把结果给我看。

AI 客户端会自动串起工具调用：

```text
sandbox_create(template="code-interpreter-v1", timeout_ms=600000)
  -> sandbox_id: sbx-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

run_code(sandbox_id="sbx-...", language="python", code="import pandas as pd; ...")
  -> 45

sandbox_kill(sandbox_id="sbx-...")
```

不想显式管理沙箱时，直接省略 `sandbox_id`：

```text
run_command(command="uname -a && python3 --version")
  -> Linux ... x86_64 GNU/Linux
     Python 3.11.x
     [exitCode: 0]
```

## 配置项

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `E2B_API_KEY` | — | **必填**，Agent Sandbox 控制台创建的 API Key |
| `REGION` | `cn-hangzhou` | 地域，决定默认域名与 API 地址 |
| `E2B_DOMAIN` | `<region>.sandbox.aliyuncs.com` | 沙箱域名 |
| `E2B_API_URL` | `https://api.<region>.sandbox.aliyuncs.com` | 控制面 API 地址 |
| `E2B_TEMPLATE` | `code-interpreter-v1` | 默认模板 |
| `SANDBOX_TIMEOUT_MS` | `300000` | 默认沙箱 TTL（毫秒） |
| `SANDBOX_MAX_OUTPUT_CHARS` | `30000` | 单次工具返回的最大字符数 |
| `SANDBOX_ENV_FILE` | — | 指向一个 dotenv 文件，读取上述变量 |

环境变量优先级高于 dotenv 文件。

## 命令行

```text
aliyun-agent-sandbox-mcp              # 启动 MCP stdio server（默认行为）
aliyun-agent-sandbox-mcp --check      # 打印配置并校验，未配置 Key 时退出码为 1
aliyun-agent-sandbox-mcp --help
aliyun-agent-sandbox-mcp --version
```

## 开发

```bash
npm install
npm run build          # tsc -> dist/
npm run typecheck
npm run test:unit      # 离线单元测试
npm run test:integration   # 需要 E2B_API_KEY，会真实创建/销毁沙箱
```

集成测试的完整输出：

```text
Discovered 14 tools: sandbox_status, sandbox_create, sandbox_list, sandbox_info,
sandbox_kill, sandbox_set_timeout, run_command, run_code, file_read, file_write,
file_list, file_make_dir, file_remove, file_rename

  ok   sandbox_status reports the endpoint
  ok   sandbox_create returns an id
  ok   run_command runs a shell command
  ok   run_code runs Python in the kernel
  ok   run_code runs JavaScript
  ok   file_write writes a file
  ok   file_read reads it back
  ...
ALL CHECKS PASSED
```

## 注意事项

- 沙箱按使用时长计费，用完请调用 `sandbox_kill`；临时沙箱模式会在工具返回前自动销毁。
- 极速版单沙箱默认最长运行 86400s，磁盘 15GB，详见[使用限制](https://help.aliyun.com/zh/agent-sandbox/usage-constraints-of-fc-agent-sandbox)。
- 本项目只是 MCP 封装层，不修改阿里云官方 SDK 行为；协议兼容性问题请以官方文档为准。

## License

[MIT](./LICENSE)
