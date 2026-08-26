# 2026-08-26 角色查手机 — P0 第 2 步：前端 Capacitor 桥 + 工具注册 + useChatAI dispatch

暮色 8-26 18:34 决定"命令行编译 + 直接做 commit 2"。

## 这次落地内容

### 1. Capacitor 桥 + mock fallback（`utils/phoneUsage.ts`，~270 行）

**6 个公开方法**（5 数据 + 2 权限中的 2 个）：

| 方法 | 真机 | Web 端（fallback） |
|---|---|---|
| `getCurrentApp()` | Capacitor 调 `getCurrentApp()` | mock: Safari |
| `getAppUsageToday()` | Capacitor 调 `getAppUsageToday()` | mock: 微信 87min / Chrome 54min / 抖音 42min / 小红书 28min / SullyOS 19min |
| `getTotalScreenTimeToday()` | Capacitor 调 `getTotalScreenTimeToday()` | mock: 230min + 12 解锁 |
| `getRecentApps({limit})` | Capacitor 调 `getRecentApps({limit})` | mock: Safari / 微信 / Chrome / 抖音 / 小红书 / SullyOS |
| `checkPermission()` | Capacitor 调 `checkPermission()` | true（mock 不需要权限） |
| `requestPermission()` | Capacitor 调 `requestPermission()` | noop |

**判定逻辑**：`Capacitor.isNativePlatform()` — 桌面/web 永远走 mock，Android 真机走真 Capacitor。

**格式化辅助**（`formatUsageForLLM`）：把数据转成自然语言，LLM 不用自己算时间：
- `currentApp`: "暮色当前在用 Chrome（包名 com.google.Chrome），前台时间 16:34"
- `appUsageToday`: "今日各 app 使用时长（按时长降序）：\n1. 微信 — 87 分钟\n2. Chrome — 54 分钟\n..."
- `screenTimeToday`: "今日总屏幕时间：3 小时 50 分钟，解锁 12 次"
- `recentApps`: "最近切换的 app（按时间倒序）：\n- Safari（1 分钟前）\n- 微信（8 分钟前）\n..."

mock 数据 appName 加 `[Mock]` 前缀 — 暮色 web 测时一眼能看出是 mock。

### 2. 工具 schema（`hooks/useChatAI.ts` 新加 `PHONE_USAGE_TOOL`）

跟 `IMAGE_GENERATION_TOOL` / `PLAY_SONG_TOOL` 同款结构：

```ts
{
  type: 'function',
  function: {
    name: 'get_phone_usage',
    description: 'Query user phone usage. Use only when: ...',
    parameters: {
      type: 'object',
      properties: {
        type: { enum: ['current_app', 'usage_today', 'screen_time', 'recent_apps'] },
        limit: { type: 'number', description: 'Only for recent_apps. Default 5.' },
      },
      required: ['type'],
    },
  },
}
```

暮色 8-14 缩 description 习惯沿用：~200 字符核心规则，删冗余。

### 3. 工具注册到 LLM（`hooks/useChatAI.ts` `toolsList` 块）

play_song 之后追加：
```ts
toolsList.push(PHONE_USAGE_TOOL);
```

**无条件注册** — commit 3 加 `char.phoneUsageEnabled` 开关（跟 `playSongEnabled` / `imageGenEnabled` 同款）。

### 4. useChatAI dispatch（line ~2750 之后，紧跟 play_song）

跟生图/放歌同款"3.X 工具处理"模式：
- 解析参数（type / limit）
- switch 调对应 phoneUsage 方法
- 拼 assistant + tool + system 消息
- **删 tools 调 followup**（避免 LLM 再调 get_phone_usage 死循环）
- Gemini 协议走 `doGeminiRequest`，OpenAI 协议走 `safeFetchJson`
- `allowXiaoZhiTiaoParse = false`（工具调用 followup 不解析小纸条）

**关键差异**（vs play_song）：
- **不存消息**（不像 play_song 三件套）— phone_usage 是只读工具，LLM 拿数据后自然接话即可
- **不画卡片**（不像 music_card）— 没有"用户可见的新内容"产生
- **成功也调 followup**（play_song 成功不调）— LLM 需要把数据自然说出来

### 5. 编译验证

- `npx tsc --noEmit`：phoneUsage.ts 0 错；我加的 useChatAI 块 0 错（pre-existing 错都跟我无关）
- `npx vite build`：4.22 秒通过，dist 生成

## 暮色下一步

1. **`npx vite dev`** 起本地 web（macOS Chrome）
2. **进 SullyOS 跟江澈聊** — 试着说"我刚才在刷什么 app 啊" / "今天屏幕用多久了"
3. **观察**：
   - 江澈会不会调 `get_phone_usage`（要 LLM 触发）
   - 调起来后能不能拿到 mock 数据
   - 拿数据后能不能自然地说出"你刚才在刷 Safari 啊"之类
4. 如果 LLM **没**调 / 调了**没**返回 → 看 console log 跟 LLM 请求/响应
5. 跑通后告诉麦麦，开干 commit 3（设置页 toggle + 权限引导 + 4 个 type 完整支持）

## 关联

- 8-20 memory "改协议层拆 4 步" 仍生效 — commit 2 也只做"mock 链路通"，真实数据等 Android 真机集成（不在这次 commit）
- 7-31 memory "AI 感知 system 消息" — phone_usage 数据**可以**主动引用（用户行为），但 commit 4 才会改 prompt 触发主动关心
- 8-02 memory "英文专业词翻译" — description 里的 `foreground / screen time / unlock count` 没翻译（API 习惯），console log 跟用户消息都用了中文"当前前台 app / 今日屏幕时间 / 解锁次数"
- 8-25 memory "commit + push preview 默认，merge master 特权" — commit 2 同样只 push preview，不合 master
