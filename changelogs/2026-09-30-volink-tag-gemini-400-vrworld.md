# Gemini 直连带出来的三个后续故障：英文标签被念出来 / 剧场 400 / 彼方独立 API 绕过归一化

**日期**：2026-09-30
**涉及 commit**：（见 git log，`fix/call-voice` 分支）

## 改了什么

暮色反馈三件事：打电话语音开头会念一个英文标签、见面 app 剧情开场报 400、彼方 app 报 503。
前两个定位到根因并修好，第三个（503）定位到一处真实漏洞但**根因未确认**，见文末。

### 1. 语音开头念英文标签（已修）

打电话的文本在送去合成前会过 `convertNarrationCues()`，把中文舞台指示
（轻笑）（叹气）（呻吟）转成 **MiniMax 私有语法**的语气标签：`(chuckle)` `(sighs)` `(groans)`。

MiniMax 认得这些标签，会当成音效演绎。**Volink 不认**——它只当普通文字，
于是把 "chuckle" "sighs" 一个词一个词念出来。打电话每句开头都可能带（轻笑），
所以特别明显。

修法：`utils/minimaxTts.ts` 加 `cleanTextForVolinkTts()`，Volink 路径专用的清理，
在 `cleanTextForTts()` 之后**再剥一层**语气标签；`synthesizeSpeechVolink` 改用它。

- 剥掉总比念出来强——舞台指示本来就不该被朗读。
- **不能直接改 `cleanTextForTts`**：那边剥了 MiniMax 自己就听不出笑声了。
- 影响面比打电话大：聊天走的是同一条 Volink 路径，**一起修好了**。

### 2. 见面 app 剧情开场 400（已修）

报错原文：

```
400 Invalid JSON payload received. Unknown name "frequency_penalty": Cannot find field.
status: INVALID_ARGUMENT
```

地址补了 `/openai` 之后请求确实打到 Google 了（这步是对的），但请求体里带着
OpenAI 专属的 `frequency_penalty` / `presence_penalty`（重复度惩罚），
Gemini 原生 API 没有对应概念，Google 直接拒收。全项目只有 `storyTheater.ts` 发这两个参数。

修法：`utils/chatApiCompat.ts` 加 `toGeminiCompatRequestBody(body, baseUrl)`，
打到 Google 兼容层时摘掉这两个参数；`storyTheater.ts` 流式 / 非流式两个请求点都接上。

**判据必须是「实际请求地址」而不是「声称的协议」**——`getResolvedRPApiConfig()`
第 909-918 行把主配置硬编码成 `protocol: 'openai'`（注释写「套壳为 openai 协议」），
所以主配置切到 Gemini 直连后，地址是兼容层地址、protocol 却还是 openai。
按 protocol 判断会漏掉，然后继续被 Google 打回 400。

### 3. 彼方独立 API 绕过归一化（已修，但 503 根因未确认）

`runSession` 的 API 优先级是「角色自带 > 彼方独立 API > 聊天默认」。
后两者里只有「聊天默认」经过 OSContext 归一化；「角色自带」和「彼方独立 API」
是从角色档案 / IndexedDB 直接读的**原始配置**，协议是 Gemini 时 baseUrl 是空的、
也没补 `/openai`。两处都补了 `withEffectiveChatApi()`。

## 踩坑 / 需要知道的（重要）

### 这次三个问题里有两个是上一轮 Gemini 归一化的「下游」

补 `/openai` 后缀只解决了**地址**，没解决**请求体**——Google 的 OpenAI 兼容层
不是 OpenAI 的完全超集，参数也比原生 API 少。协议兼容 = 地址 + 鉴权头 + 请求体 +
参数集，四样都得对，只改地址会出现「打通了但立刻 400」这种半通状态。

### `protocol` 字段在项目里不可尽信

至少两处会把主配置套壳成 `protocol: 'openai'`（`storyTheater.getResolvedRPApiConfig`），
所以「按 protocol 分支」和「按实际地址分支」要分清：
**决定打到哪儿用 protocol，决定参数/请求体格式用实际地址。**

### 类型错误的基线是 573 条

`npx tsc --noEmit` 在这个项目里本来就有 573 条（`vrState` 不在 types 里之类）。
本轮用 `git stash` 做了改前/改后对比：**573 → 573，差异只有行号位移**，
没有新增任何一类错误。别拿 tsc 全量输出的条数当质量指标。

## 备注

- **彼方的 503 还没定位。** 代码里有两个可能来源，静态看不出来：
  1. 模型接口 → `safeFetchJson` 把 503 当可重试状态码重试 2 次，最后抛
     `API Error 503: <响应体里的 message>`；
  2. 彼方的「邮局」是另一个远程服务（`utils/vrWorld/postOffice.ts`，独立的
     `DEFAULT_BASE`），挂了就直接 `HTTP 503`。

  需要暮色把报错原文给出来才能确定——彼方 →「API」标签 →「调用记录」里失败那条
  的错误文本，或者直接看 toast。
- Volink 剥掉的是 MiniMax 语气标签；如果以后 CosyVoice 支持情绪标记，
  可以改成映射而不是删除。
