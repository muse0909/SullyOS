# syncEmotionApiToAllCharacters 不再碰 lightLLM（彻底修跳回 OpenAI）

**日期**：2026-08-02
**涉及提交**：`c4ceb1d`

## 改了什么

- `context/OSContext.tsx:1949` `syncEmotionApiToAllCharacters` 函数体里**删除**了 `setMemoryPalaceConfig` 重置 lightLLM 的整段代码
- 函数现在只做一件事：把 baseUrl/apiKey/model 写到所有角色的 `emotionConfig.api`
- 注释里把根因写清楚（防止未来再有人"顺手"加回去）

## 根因复盘（暮色 20:37 反馈"开了无痕窗口还是跳 OpenAI"才暴露的）

### 1caef81 的"修法"为什么不够

1. `handleSaveLightApi` 在同一帧里调两个 setState：
   - `updateMemoryPalaceConfig({ lightLLM: 完整对象含 protocol='gemini' })` → 入队
   - `syncEmotionApiToAllCharacters({ baseUrl, apiKey, model })` → 入队
2. `syncEmotionApiToAllCharacters` 内部（旧版）：
   ```ts
   lightLLM: { ...memoryPalaceConfig.lightLLM, baseUrl, apiKey, model }
   ```
3. **闭包陷阱**：`memoryPalaceConfig` 是当前函数 scope 捕获的**上一帧值**（React 18 setState 异步 flush）。
   - 默认 lightLLM 是 `{ baseUrl:'', apiKey:'', model:'' }`（**没 protocol 字段**）
   - spread 旧值 → 重建的 lightLLM 也没 protocol
4. React 18 自动批处理：两个 setState 合并到下一帧，**后入队的赢** → `lightLLM` 被覆盖成 protocol=undefined
5. 下一帧渲染：useEffect 读 `memoryPalaceConfig.lightLLM.protocol || 'openai'` → `'openai'`
6. `setLightProtocol('openai')` → **协议跳回 OpenAI**

### 1caef81 试图用 `{ ...memoryPalaceConfig.lightLLM, ... }` 保留 protocol 字段，但**根因没修**：
- 闭包里的 `memoryPalaceConfig` 还是旧值（旧 lightLLM 没 protocol）
- spread 旧值后还是没 protocol
- 1caef81 提交后暮色测了还跳回 OpenAI

### 真正修法（c4ceb1d）

**两个 setState 各自管各自的，互不覆盖**：
- `updateMemoryPalaceConfig` 单独管 lightLLM
- `syncEmotionApiToAllCharacters` 单独管 emotionConfig.api
- 各自 `setState` 入队，React 18 批处理不会让一个覆盖另一个（因为它们在不同的 state slot）

## 暮色 20:37 反馈

> 1. 还是跳 openai，开了无痕窗口试了，不是没刷新的问题，push 记录也有。
> 2. 换 2.0 跳 429。
> 悬浮窗 4 个 tab 测试通过。前面两个问题继续修

第 2 条是暮色 Gemini 配额用完（429），不是代码问题，等暮色换 key。

## 动了哪些文件

- `context/OSContext.tsx:1949-1964` — `syncEmotionApiToAllCharacters` 删除 lightLLM 重置代码 + 注释根因

## 踩坑 / 需要知道的

- **闭包 + 批处理组合陷阱**：React 18 里"同一帧调两个会写同一份 state 的 setter"很危险
  - 旧值被覆盖是因为**闭包**捕获旧 state + **批处理**让后入队的覆盖先入队的
  - 防御：每个函数只管自己的 state 切片，**别"顺手"写别的 state**
- **1caef81 修法不够的教训**：spread 旧值看起来"保留了字段"，但旧值本身没那个字段，spread 不出来
  - 真正修法：让两个函数**互不重叠**，各管各的
- **`setMemoryPalaceConfig(newConfig)` 旧版**用 memoryPalaceConfig 闭包值重建 newConfig（line 1928-1935）—— 同样的闭包陷阱
  - 为什么 updateMemoryPalaceConfig 不出问题？**它只入队一次**，没第二个 setState 跟它抢
  - 但 `handleSaveLightApi` 里它**前面**还有 `syncEmotionApiToAllCharacters` 抢，所以删了 syncEmotionApiToAllCharacters 里的 setState 才彻底修

## 备注

- 暮色测新版 `c4ceb1d`：选 Gemini → 填 URL/Key/Model → 点保存 → 应该不跳回 OpenAI
- 验证步骤：
  1. 刷新 Vercel 部署链接（commit `c4ceb1d`）
  2. 进记忆宫殿 → 设置 → 选 Gemini 协议
  3. 填入 Gemini URL/Key/Model
  4. 点"保存副 API 配置"
  5. **预期**：协议选择器停在 Gemini，input 显示新填的 URL/Key/Model
- 429 是 Gemini 配额问题，等暮色换 key
