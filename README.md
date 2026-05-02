# Codex CF Proxy

让 Codex (App / CLI) 使用 DeepSeek 等第三方模型的 Cloudflare Worker。

## 原理

Codex 使用 OpenAI 的 **Responses API** (`/v1/responses`)，而 DeepSeek 等第三方模型只支持标准 **Chat Completions** (`/v1/chat/completions`)。

这个 Worker 在中间做协议转换：

```
Codex → [Responses API] → CF Worker → [Chat Completions] → DeepSeek/中转站
```

## 部署（二选一）

### 方式 A：本地部署（推荐）

```bash
# 1. 安装 wrangler
npm install -g wrangler

# 2. 登录 Cloudflare（浏览器认证）
wrangler login

# 3. 部署
git clone https://github.com/shenyeah/codex-cf-proxy.git
cd codex-cf-proxy
wrangler deploy
```

### 方式 B：GitHub Actions 自动部署

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 添加两个 Secret：

| Secret 名称 | 值 |
|-------------|-----|
| `CF_ACCOUNT_ID` | `e6f2b55e81e5024cd1a10c3744032b35` |
| `CF_API_TOKEN` | 你的 Cloudflare API Token |

然后在仓库创建 `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Cloudflare Workers
on:
  push:
    branches: [main]
  workflow_dispatch:
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Deploy Worker
        run: npx wrangler deploy
        env:
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
```

配置好 Secrets 后，去 Actions 页面手动触发 workflow 即可。

## API Token 权限

在 Cloudflare Dashboard → **My Profile → API Tokens** 创建 Token，需要以下权限：

- `Workers Scripts → Edit`
- `Workers Routes → Edit`

## 环境变量

部署成功后，在 Cloudflare Dashboard → Workers & Pages → `codex-cf-proxy` → **Settings → Variables** 设置：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `UPSTREAM_BASE_URL` | `https://api.deepseek.com/v1` | 上游 API 地址 |
| `MODEL_NAME` | `deepseek-chat` | 模型名称 |

API Key 建议用 **x-api-key 请求头** 传入（见下方 Codex 配置），而非写成环境变量。

## Codex 配置

配置 `~/.codex/config.toml`:

```toml
model = "deepseek-chat"
model_provider = "cf-deepseek"

[model_providers.cf-deepseek]
name = "CF DeepSeek Proxy"
base_url = "https://codex-cf-proxy.shenye.workers.dev/v1"
env_key = "DEEPSEEK_API_KEY"
wire_api = "responses"
```

终端设环境变量：

```bash
export DEEPSEEK_API_KEY="你的DeepSeek API Key"
```

## 配合中转站

如果 DeepSeek 官方 API 连不上（国内网络问题），把 Worker 的 `UPSTREAM_BASE_URL` 改成你的中转站地址。

## License

MIT
