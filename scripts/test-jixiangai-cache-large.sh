#!/bin/bash
# 即享 /v1/messages 端点 + cache_control 透传验证
# 暮色 2026-07-17：用 ≥ 4096 token 的 system 测（之前测试 input 太小不创建 cache）
#
# 关键修正：
#   - Anthropic 协议标准：system 是**顶层字段**，不在 messages 里
#   - 用 Python 写 JSON 到文件，避免 shell heredoc 中文转义问题
#
# 用法：
#   1) 把下面的 sk-REPLACE-ME 替换成你的真实即享 API key
#   2) chmod +x test-jixiangai-cache-large.sh
#   3) ./test-jixiangai-cache-large.sh

KEY="sk-REPLACE-ME"
OUT_DIR="/tmp/jixiangai-test"
mkdir -p "${OUT_DIR}"

# 用 Python 生成 JSON 文件，避免 shell 转义问题
python3 <<PYEOF
import json, os

# ~5000 token 的 system 文本（重复填充）
# "这是测试缓存的填充文本。请忽略这段内容。" * 500 ≈ 2000 token
# 再加 2000 token 的真实 system 提示，总共 ≈ 4000 token
real_system = "你是一只猫，只回答喵。\n你叫喵喵，今年 3 岁。你住在一个温暖的小屋里，最喜欢晒太阳和玩毛线球。你的性格温柔、慵懒、偶尔调皮。你说话总是用简短、慵懒的语气，偶尔会发出呼噜声。你不喜欢被抱得太紧，但会主动蹭蹭主人的腿。"
padding = "这是测试缓存的填充文本。请忽略这段内容。" * 500
full_system = real_system + "\n\n" + padding

# ⚠️ 关键：Anthropic 协议标准 - system 在顶层字段，不在 messages 里
body = {
    "model": "claude-opus-4-6",
    "max_tokens": 100,
    "system": [
        {
            "type": "text",
            "text": full_system,
            "cache_control": {"type": "ephemeral", "ttl": "1h"}
        }
    ],
    "messages": [
        {"role": "user", "content": "你好"}
    ]
}

with open(f"{os.environ['OUT_DIR']}/req1.json", "w", encoding="utf-8") as f:
    json.dump(body, f, ensure_ascii=False)

# 第 2 次请求用同样的 system
body["messages"] = [{"role": "user", "content": "在吗"}]
with open(f"{os.environ['OUT_DIR']}/req2.json", "w", encoding="utf-8") as f:
    json.dump(body, f, ensure_ascii=False)

print(f"System 文本 token 数（粗略估算）: {len(full_system) // 2}")
print(f"System 文本字符数: {len(full_system)}")
print(f"已生成 req1.json + req2.json 到 {os.environ['OUT_DIR']}/")
PYEOF

echo ""
echo "===== 第 1 次请求（应该 cache_creation_input_tokens > 0）====="
curl -s -X POST https://cn.jixiangai.xyz/v1/messages \
  -H "x-api-key: ${KEY}" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d @"${OUT_DIR}/req1.json"
echo ""
echo ""
echo "===== 第 2 次请求（应该 cache_read_input_tokens > 0）====="
curl -s -X POST https://cn.jixiangai.xyz/v1/messages \
  -H "x-api-key: ${KEY}" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d @"${OUT_DIR}/req2.json"
echo ""
