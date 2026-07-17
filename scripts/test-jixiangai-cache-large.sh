#!/bin/bash
# 即享 /v1/messages 端点 + cache_control 透传验证
# 暮色 2026-07-17：用 ≥ 4096 token 的 system 测（之前测试 input 太小不创建 cache）
#
# 用法：
#   1) 把下面的 sk-REPLACE-ME 替换成你的真实即享 API key
#   2) chmod +x test-jixiangai-cache-large.sh
#   3) ./test-jixiangai-cache-large.sh

KEY="sk-REPLACE-ME"

# 用 Python 生成一个 ~5000 token 的 system（重复填充文本）
# 中文 1 字 ≈ 1.5 token，5000 token ≈ 3300 字
# "这是测试缓存的填充文本。请忽略这段内容。" * 200 ≈ 1200 字 ≈ 1800 token
# 重复次数算保守点 = 500 次 ≈ 2000 token，加上 2000 字符真实内容 ≈ 4500 token
SYSTEM_BODY=$(python3 -c "print('这是测试缓存的填充文本。请忽略这段内容。' * 500, end='')")

# 第一次：建立 cache（应该 cache_creation_input_tokens > 0）
echo "===== 第 1 次请求（应该 cache_creation > 0）====="
curl -s -X POST https://cn.jixiangai.xyz/v1/messages \
  -H "x-api-key: ${KEY}" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d @- <<JSON
{
  "model": "claude-opus-4-6",
  "max_tokens": 100,
  "system": [
    {
      "type": "text",
      "text": "${SYSTEM_BODY}",
      "cache_control": {"type": "ephemeral", "ttl": "1h"}
    }
  ],
  "messages": [
    {"role": "user", "content": "你好"}
  ]
}
JSON

echo ""
echo ""
echo "===== 第 2 次请求（应该 cache_read > 0）====="
curl -s -X POST https://cn.jixiangai.xyz/v1/messages \
  -H "x-api-key: ${KEY}" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d @- <<JSON
{
  "model": "claude-opus-4-6",
  "max_tokens": 100,
  "system": [
    {
      "type": "text",
      "text": "${SYSTEM_BODY}",
      "cache_control": {"type": "ephemeral", "ttl": "1h"}
    }
  ],
  "messages": [
    {"role": "user", "content": "在吗"}
  ]
}
JSON

echo ""
