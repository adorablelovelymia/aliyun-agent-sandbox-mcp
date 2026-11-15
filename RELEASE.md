# Release checklist

Everything below is prepared and verified. Only the three **publish** steps at
the end are irreversible — run them once the release is approved.

## Verified before release

| Check | Command | Result |
| --- | --- | --- |
| Clean-clone CI | `git clone && npm ci && npm run build && npm run test:unit` | build ok, 10/10 tests pass |
| Live integration | `E2B_API_KEY=... npm run test:integration` | 16/16 checks pass on a real sandbox |
| Package contents | `npm pack --dry-run` | 18 files, 19.9 kB packed / 74.7 kB unpacked |
| Publish dry run | `npm publish --dry-run` | resolves to `aliyun-agent-sandbox-mcp@0.1.0`, public |
| Installed bin | pack → `npm i -g` → run | symlinked `--version` / `--check` / stdio all work |
| No secrets staged | `git ls-files | grep -c '.env$'` | 0 |

## 1. GitHub

```bash
gh repo create adorablelovelymia/aliyun-agent-sandbox-mcp   --public   --description "MCP server for Alibaba Cloud Agent Sandbox: run commands, execute code and manage files in cloud sandboxes"   --source . --remote origin --push

gh repo edit --add-topic mcp,modelcontextprotocol,alibaba-cloud,aliyun,agent-sandbox,e2b,code-interpreter,llm

git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

## 2. npm

```bash
npm publish --access public
```

`prepublishOnly` rebuilds and re-runs the unit tests, so a broken build
cannot be published.

## 3. GitHub Release

```bash
gh release create v0.1.0 --title "v0.1.0" --notes-file CHANGELOG.md
```

Publishing a release also triggers `.github/workflows/publish.yml`, which
republishes with provenance. **Add the `NPM_TOKEN` repository secret first**,
otherwise that workflow fails (harmlessly) on the already-published version.

## Typical failures and fixes

- `E403` on publish → token lacks publish rights, or the name is taken. Check
  `npm whoami` and `npm view aliyun-agent-sandbox-mcp`.
- `EOTP` → the account enforces 2FA; pass `--otp=<code>`.
- Provenance error in CI → the workflow needs `id-token: write` (already set).
