/**
 * Codex Responses API → Chat Completions Proxy
 *
 * 让 Codex (App/CLI) 使用 DeepSeek 等第三方模型的 Cloudflare Worker。
 * 将 Codex 的 Responses API (/v1/responses) 转换为标准 Chat Completions 格式。
 *
 * 环境变量:
 *   UPSTREAM_BASE_URL - 上游 API 地址 (默认 https://api.deepseek.com/v1)
 *   UPSTREAM_API_KEY  - 上游 API Key
 *   MODEL_NAME        - 模型名称 (默认 deepseek-chat)
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }));
    }
    const apiKey = request.headers.get('x-api-key') ||
                   request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
                   env.UPSTREAM_API_KEY;
    try {
      if (request.method === 'GET' && path === '/v1/models') {
        return handleModels(env);
      }
      if (request.method === 'POST' && path === '/v1/responses') {
        return handleResponses(request, env, apiKey);
      }
      if (request.method === 'POST' && path === '/v1/chat/completions') {
        return handlePassthrough(request, env, apiKey);
      }
      return cors(new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      }));
    } catch (err) {
      return cors(new Response(JSON.stringify({ error: err.message }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      }));
    }
  },
};
function handleModels(env) {
  const modelName = env.MODEL_NAME || 'deepseek-chat';
  return cors(new Response(JSON.stringify({
    data: [{ id: modelName, object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'deepseek' }],
  }), { headers: { 'Content-Type': 'application/json' } }));
}
async function handleResponses(request, env, apiKey) {
  const body = await request.json();
  const { model, input, instructions, tools, stream, ...rest } = body;
  const messages = buildMessages(input, instructions);
  const upstreamBase = env.UPSTREAM_BASE_URL || 'https://api.deepseek.com/v1';
  const modelName = env.MODEL_NAME || 'deepseek-chat';
  const chatBody = { model: modelName, messages, stream: !!stream };
  if (rest.max_output_tokens) chatBody.max_tokens = rest.max_output_tokens;
  if (rest.temperature != null) chatBody.temperature = rest.temperature;
  if (rest.top_p != null) chatBody.top_p = rest.top_p;
  if (rest.stop) chatBody.stop = rest.stop;
  if (rest.presence_penalty != null) chatBody.presence_penalty = rest.presence_penalty;
  if (rest.frequency_penalty != null) chatBody.frequency_penalty = rest.frequency_penalty;
  if (tools && tools.length > 0) {
    chatBody.tools = tools.map(t => ({
      type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema || t.parameters },
    }));
  }
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  const upstreamResponse = await fetch(`${upstreamBase}/chat/completions`, {
    method: 'POST', headers, body: JSON.stringify(chatBody),
  });
  if (!upstreamResponse.ok) {
    return cors(new Response(await upstreamResponse.text(), {
      status: upstreamResponse.status, headers: { 'Content-Type': 'application/json' },
    }));
  }
  if (stream) {
    const transformed = upstreamResponse.body.pipeThrough(createResponsesSSETransform(model || modelName));
    return cors(new Response(transformed, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
    }));
  }
  const chatResult = await upstreamResponse.json();
  return cors(new Response(JSON.stringify(toResponsesFormat(chatResult, model || modelName)), {
    headers: { 'Content-Type': 'application/json' },
  }));
}
async function handlePassthrough(request, env, apiKey) {
  const upstreamBase = env.UPSTREAM_BASE_URL || 'https://api.deepseek.com/v1';
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  const upstreamResponse = await fetch(`${upstreamBase}/chat/completions`, {
    method: 'POST', headers, body: await request.text(),
  });
  return cors(new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: { 'Content-Type': upstreamResponse.headers.get('Content-Type') || 'application/json' },
  }));
}
function buildMessages(input, instructions) {
  const messages = [];
  if (instructions) messages.push({ role: 'system', content: instructions });
  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input });
  } else if (Array.isArray(input)) {
    for (const item of input) {
      if (item.type === 'tool_call' || item.type === 'tool_result') {
        messages.push({ role: 'tool', tool_call_id: item.id, content: item.output || item.content || '' });
      } else if (item.role) {
        messages.push({ role: item.role, content: extractContent(item) });
      }
    }
  }
  return messages;
}
function extractContent(item) {
  if (typeof item.content === 'string') return item.content;
  if (Array.isArray(item.content)) {
    return item.content.map(c => (c.type === 'text' || c.type === 'input_text') ? c.text : '').join('');
  }
  return '';
}
function toResponsesFormat(chatResult, model) {
  const responseId = `resp_${randomId()}`;
  const output = (chatResult.choices || []).map((choice) => {
    const msgId = `msg_${randomId()}`;
    const message = choice.message || {};
    const content = [];
    if (message.content) content.push({ type: 'output_text', text: message.content, annotations: [] });
    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        content.push({ type: 'tool_use', id: tc.id, name: tc.function?.name || '',
          input: tc.function?.arguments ? (() => { try { return JSON.parse(tc.function.arguments); } catch { return tc.function.arguments; } })() : {} });
      }
    }
    return { id: msgId, type: 'message', role: message.role || 'assistant', status: 'completed', content };
  });
  return { id: responseId, object: 'response', created: Math.floor(Date.now() / 1000), model: model || chatResult.model, status: 'completed', output, usage: chatResult.usage || {} };
}
function createResponsesSSETransform(model) {
  const responseId = `resp_${randomId()}`;
  const msgId = `msg_${randomId()}`;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '', contentAccumulator = '';
  return new TransformStream({
    start(controller) {
      controller.enqueue(encoder.encode(`event: response.created\ndata: ${JSON.stringify({ response: { id: responseId, object: 'response', created: Math.floor(Date.now() / 1000), model, status: 'in_progress' } })}\n\n`));
      controller.enqueue(encoder.encode(`event: response.output_item.added\ndata: ${JSON.stringify({ output_index: 0, item: { id: msgId, type: 'message', role: 'assistant', status: 'in_progress', content: [] } })}\n\n`));
    },
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const choice = parsed.choices?.[0];
          if (choice?.delta?.content) {
            contentAccumulator += choice.delta.content;
            controller.enqueue(encoder.encode(`event: response.output_text.delta\ndata: ${JSON.stringify({ delta: choice.delta.content, item_id: msgId, output_index: 0, content_index: 0 })}\n\n`));
          }
          if (choice?.delta?.tool_calls) {
            for (const tc of choice.delta.tool_calls) {
              controller.enqueue(encoder.encode(`event: response.output_item.added\ndata: ${JSON.stringify({ output_index: 0, item: { id: tc.id || 'call_'+randomId(), type: 'function_call', status: 'in_progress', name: tc.function?.name || '', arguments: tc.function?.arguments || '', call_id: tc.id } })}\n\n`));
            }
          }
        } catch (e) {}
      }
    },
    flush(controller) {
      if (buffer.startsWith('data: ') && buffer !== 'data: [DONE]') {
        try {
          const parsed = JSON.parse(buffer.slice(6));
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            contentAccumulator += delta.content;
            controller.enqueue(encoder.encode(`event: response.output_text.delta\ndata: ${JSON.stringify({ delta: delta.content, item_id: msgId, output_index: 0, content_index: 0 })}\n\n`));
          }
        } catch (e) {}
      }
      controller.enqueue(encoder.encode(`event: response.output_text.done\ndata: ${JSON.stringify({ item_id: msgId, output_index: 0, content_index: 0, content: contentAccumulator })}\n\n`));
      controller.enqueue(encoder.encode(`event: response.done\ndata: ${JSON.stringify({ response: { id: responseId, object: 'response', created: Math.floor(Date.now() / 1000), model, status: 'completed', output: [{ id: msgId, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: contentAccumulator, annotations: [] }] }] } })}\n\n`));
    },
  });
}
function randomId() {
  return crypto.randomUUID ? crypto.randomUUID().split('-').join('').substring(0, 8) : Math.random().toString(36).substring(2, 10);
}
function cors(response) {
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
  return response;
}