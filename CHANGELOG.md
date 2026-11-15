# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Raise the Node.js floor to **20.19.0**. e2b's CJS bundle `require()`s the ESM
  `chalk` package, and `require(ESM)` is only enabled by default from Node
  20.19.0, so 20.18.1 crashed with `ERR_REQUIRE_ESM` on startup.
- GitHub Actions workflows used single-brace `${matrix.node}` /
  `${secrets.NPM_TOKEN}` instead of `${{ }}`, so `setup-node` tried to install a
  Node version literally named `${matrix.node}` and every job failed.
- The integration test asserted on `sandbox_list` immediately after
  `sandbox_create`; the control-plane list endpoint is eventually consistent
  (observed ~500 ms lag), so the check now polls briefly. `sandbox_list`'s tool
  description documents the behaviour.

## [0.1.0] - 2026-11-15

First public release.

### Added

- MCP server for **Alibaba Cloud Agent Sandbox (阿里云智能体沙箱)**, speaking the
  E2B-compatible protocol over stdio.
- 14 tools:
  - lifecycle: `sandbox_status`, `sandbox_create`, `sandbox_list`,
    `sandbox_info`, `sandbox_set_timeout`, `sandbox_kill`
  - execution: `run_command`, `run_code` (Python / JavaScript /
    TypeScript / Bash / R / Java)
  - filesystem: `file_read`, `file_write`, `file_list`,
    `file_make_dir`, `file_rename`, `file_remove`
- Endpoint auto-derived from `REGION`:
  `<region>.sandbox.aliyuncs.com` and
  `https://api.<region>.sandbox.aliyuncs.com`, overridable via
  `E2B_DOMAIN` / `E2B_API_URL`.
- Optional `sandbox_id` on every sandbox-bound tool: reuse a long-lived
  sandbox, or omit it to create and destroy an ephemeral one per call.
- Bounded tool output (head + tail truncation) controlled by
  `SANDBOX_MAX_OUTPUT_CHARS`.
- dotenv support through `.env` discovery and `SANDBOX_ENV_FILE`.
- CLI flags: `--check`, `--help`, `--version`.
- 10 offline unit tests and a live integration test that drives the built
  server through a real MCP client.
- GitHub Actions: CI matrix on Node 20 / 22 / 24, plus a tagged-release
  publish workflow.

[Unreleased]: https://github.com/adorablelovelymia/aliyun-agent-sandbox-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/adorablelovelymia/aliyun-agent-sandbox-mcp/releases/tag/v0.1.0
