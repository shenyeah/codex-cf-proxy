# Codex CF Proxy

让 Codex (App / CLI) 使用 DeepSeek 等第三方模型的 Cloudflare Worker。

## 原理

Codex 使用 OpenAI 的 **Responses API** (`/v1/responses`)，而 DeepSeek 等第三方模型只支持标准 **Chat Completions** (`/v1/chat/completions`)。

这个 Worker 在中间做协议转换：

```
Codex → [Responses API] → CF Worker → [Chat Completions] → DeepSeek/中转站
```

## 部署

### 方式一：Wrangler CLI

```bash
npm install -g wrangler
wrangler login
wrangler deploy
```

### 方式二：Cloudflare Dashboard

1. 进入 Cloudflare Dashboard → Workers & Pages
2. 创建 Worker，将 `src/index.js` 的代码粘贴进去
3. 在 Settings → Variables 中添加环境变量

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `UPSTREAM_BASE_URL` | `https://api.deepseek.com/v1` | 上游 API 地址 |
| `UPSTREAM_API_KEY` | - | 上游 API Key |
| `MODEL_NAME` | `deepseek-chat` | 模型名称 |

## Codex 配置

配置 `~/.codex/config.toml`:

```toml
model = "deepseek-chat"
model_provider = "cf-proxy"

[model_providers.cf-proxy]
name = "CF Proxy"
base_url = "https://你的worker名称.你的子域.workers.dev/v1"
env_key = "CF_API_KEY"

# 方式 A: 用 Responses API (wire_api = "responses")
wire_api = "responses"

# 方式 B: 或直接用 Chat Completions 透传
# wire_api = "chat"
```

环境变量:

```bash
export CF_API_KEY="你的DeepSeek API Key"
```

## 配合中转站

如果使用第三方中转站，修改 `UPSTREAM_BASE_URL` 即可:

```
UPSTREAM_BASE_URL = "https://你的中转站地址/v1"
```

## License

MIT
