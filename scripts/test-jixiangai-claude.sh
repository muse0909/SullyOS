#!/bin/bash
# 即享 /v1/messages 端点测试 — 验证 cache_control 是否透传
# 暮色 2026-07-17 跑这个测即享 Claude 端点 + cache_control
#
# 用法：
#   1) 把下面的 sk-REPLACE-ME 替换成你的真实即享 API key
#   2) chmod +x test-jixiangai-claude.sh
#   3) ./test-jixiangai-claude.sh

KEY="sk-REPLACE-ME"

# 第一次请求：建立 cache（cache_creation_input_tokens > 0）
echo "===== 第 1 次请求（建立 cache）====="
curl -s -X POST https://cn.jixiangai.xyz/v1/messages \
  -H "x-api-key: ${KEY}" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d @- <<'JSON'
{
  "model": "claude-opus-4-6",
  "max_tokens": 100,
  "system": [
    {
      "type": "text",
      "text": "你是一只猫，只回答喵。",
      "cache_control": {"type": "ephemeral", "ttl": "1h"}
    }
  ],
  "messages": [
    {"role": "user", "content": "你好"}
  ]
}
JSON

echo ""
echo "===== 第 2 次请求（应该命中 cache）====="
curl -s -X POST https://cn.jixiangai.xyz/v1/messages \
  -H "x-api-key: ${KEY}" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d @- <<'JSON'
{
  "model": "claude-opus-4-6",
  "max_tokens": 100,
  "system": [
    {
      "type": "text",
      "text": "你是一只猫，只回答喵。",
      "cache_control": {"type": "ephemeral", "ttl": "1h"}
    }
  ],
  "messages": [
    {"role": "user", "content": "在吗"}
  ]
}
JSON

echo ""
