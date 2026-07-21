# 主动消息 runProactive 改用 safeFetchJson

**日期**：2026-07-21
**涉及 commit**：`4964a2c`

## 改了什么

`context/OSContext.tsx` 里 `runProactive` 的 fetch 路径——从裸 `fetch()` 换成 `safeFetchJson()`。

## 动了哪些文件

- `context/OSContext.tsx:1392-1402` —— 9 行 fetch 路径替换成 12 行 safeFetchJson 调用

## 踩坑 / 需要知道的（重要）

### 真凶不是 CORS，是中转站 502 + 浏览器误报

暮色 2026-07-21 反馈主动消息不发了。控制台看到：

```
Access to fetch at 'https://youzi.today/v1/chat/completions' 
from origin 'https://sully-muse-vert.vercel.app' 
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header
net::ERR_FAILED 502 (Bad Gateway)
```

第一眼看像 CORS，**实际不是**。直接 curl 测：

| 域名 | CORS 头 | 实际 POST |
|---|---|---|
| `youzi.today` | ✅ `access-control-allow-origin: *` | 间歇 502 |
| `sullymeow.ccwu.cc` | ✅ allow vercel.app | alive |
| `noir2.cc.cd` | ✅ `*` | alive |

**真相**：中转站 `youzi.today` 真 502 了，**502 响应没带 CORS 头**（中转站对 5xx 错误页不会加 CORS 头），浏览器把"无 CORS 头的 502"误判成"CORS 拒绝"。

### 为什么正常聊天没事 / 主动消息挂

| 路径 | 方式 | CORS 502 挂了怎么办 |
|---|---|---|
| `useChatAI.ts` 正常聊天 | `safeFetchJson()` | 自动 retry 2 次 + fallback `/api/proxy` |
| `OSContext.tsx:runProactive` 主动消息 | **裸 `fetch()`**（今天之前一直这样写） | **直接死** |

`safeFetchJson`（`utils/safeApi.ts:280` 那段）有 CORS failed 自动 fallback 到 `/api/proxy` 的逻辑。`runProactive` 没用它，所以必死。

### 为什么是"昨天才挂"

`runProactive` 自 **2026-06-14 那次 restore（commit `f0d54fd`）** 起就一直裸 fetch——**这个 bug 一直潜在**。"昨天才挂"的可能触发：

1. 中转站最近切到 `youzi.today`（限流更严）
2. 昨天设了短 interval 的 schedule（频率高踩中转站限流）
3. 之前在 Android PWA / Capacitor WebView 测（不严格 enforce CORS），现在 Vercel Chrome 链接严格 enforce

## 修复点

```ts
// 原来（裸 fetch）
const response = await fetch(`${api.baseUrl}/chat/completions`, { ... });
const data = await response.json();

// 改后（safeFetchJson）
const apiProtocol = (api as any).protocol ?? 'openai';
const data = await safeFetchJson(`${api.baseUrl}/chat/completions`, { ... }, 2, 0, apiProtocol);
```

复用 `safeFetchJson` 已有的：
- CORS 失败自动 fallback `/api/proxy`
- 502/503/504 retry 2 次
- Claude 协议分支

## 副作用

- 错误行为变了：原来 502 时 `data.choices` undefined → 被 `|| ''` 兜成空字符串（**静默失败**）；改后会 throw → 进 catch 块打 console.error（**有声音**）
- 不影响正常 Chat / 朋友圈 / 见面的 fetch 路径（那些本来就在用 safeFetchJson）

## 备注

- secondaryApi 类型（`types.ts:989`）里**没有 `protocol` 字段**——只 baseUrl/apiKey/model
  - 默认按 OpenAI 协议走，如果用户想用 Claude 协议副 API，需要补这个字段
  - 本次没改 types，下次有人加副 API Claude 协议时再补
