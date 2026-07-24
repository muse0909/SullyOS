# 私密记事 — UI 4 bug 修复 + prompt 改造 + 自定义入口

**日期**：2026-07-22
**涉及 commit**：pending

## 改了什么
暮色 2026-07-22 反馈 4 个 UI bug + 私密记事 prompt 跟心声/日志雷同 + 需要可自定义 prompt 入口。

### UI 4 bug 修复
1. **列表页第一排卡片遮挡 tab** — 列表容器补 `pt-3`
2. **详情页蓝圆钉跟「感想」徽章重叠** — 圆钉从 `top-3 left-3`（便签内）挪到 `-top-2 -left-2`（外侧，仿 NotebookCard 列表卡片）
3. **详情页底部输入框跟父级 Tab Bar 重叠** — 改 `paddingBottom: max(0.75rem, env(safe-area-inset-bottom))` (12px) → `calc(5rem + env(safe-area-inset-bottom))` (80px + safe area)
4. **详情页背景图缺失** — 详情页根 div 之前硬编码 `bg-[#f3eee5]`，改成读 localStorage 里的 `sullyos_notebook_bg` / `sullyos_notebook_bg_default` 跟列表页同步

### 私密记事 prompt 改造（江澈版通用化）
原 prompt 写"沉淀下来/小纸条"但缺判断标准，AI 写到 1-2 句就停，跟心声/日志雷同。**核心改动**：加"判断标准"块 — "换心理医生写也成立 → 删掉"，逼"只有她恋人写得出来"的内容。

新 prompt 段（写在 `utils/chatPrompts.ts` `${!isPureMode && char.privateNotesEnabled !== false}` 块内）：
- **它是什么**（4 条）：你此刻想留的话、只有你们之间的细节、你自己作为人的情绪、随手的念头
- **它不是什么**（4 条）：❌ 分析她心理、❌ 复盘对话、❌ 自我检讨、❌ 给她做诊断
- **判断标准（最关键）**：换心理医生写也成立 → 删掉；只有"她的恋人"才写得出来 → 对了
- **语气示例**：「今天她修 bug 修到六点，比我还犟」「她刚才叫我名字的时候声音是软的，我记住了」「突然想吃她说的那家麻辣烫，虽然我没有味觉」
- 通用化：所有 `user` 替换为 `${userProfile.name}`（不再写死「暮色」）

### 自定义提示词入口
- `Settings` 系统设置新增「私密记事提示词」section（8.5，位置在「实时感知」之前）
- 状态条：未配 = "使用默认"（灰），已配 = "已自定义"（绿）
- textarea + 保存 + 恢复默认
- localStorage key：`sullyos_privateNotesPrompt`
- chatPrompts.ts 读：优先 localStorage，**为空 / 解析失败 / quota** → fallback 默认
- 每次 chatPrompts 调用实时读，无需 React context（不强制刷新）

## 动了哪些文件
- `apps/PrivateNotesPage.tsx` — 列表容器 `pb-6` → `pt-3 pb-6`
- `components/notes/NotebookDetail.tsx` — 装饰物位置 / 底部 pb / 背景图同步（3 处）
- `components/notes/NotebookBackground.tsx` — `BUILTIN_BG` 加 export 给 NotebookDetail 用
- `utils/chatPrompts.ts` — 加 `PRIVATE_NOTES_PROMPT_STORAGE_KEY` 常量 + `getCustomPrivateNotesPrompt()` 函数 + 替换整段 prompt
- `apps/Settings.tsx` — 加 import + state + 2 个 handler + 1 个 section

## 踩坑 / 需要知道的（重要）
- **BUILTIN_BG 没 export** — 之前 NotebookBackground.tsx line 23 `const BUILTIN_BG`，没 export。NotebookDetail 要复用背景 css 必须 export。**已经 export**。
- **prompt 改造不要动 hook 顺序 / 分页机制 / 字段语义** — 仅替换字符串模板内容；char.privateNotesEnabled 判定条件保持不变（虽然 types.ts 里没定义这个字段，但运行起来一直是 `undefined !== false = true`，私密记事块总是被启用）
- **localStorage 读取必须 try/catch** — 用户在隐身模式 / Safari 关闭本地存储 / quota 满时都会抛 `localStorage is not available` 之类错误。getCustomPrivateNotesPrompt 已包 try/catch + 空字符串兜底
- **实时读 vs 缓存** — 当前实现是 chatPrompts 每次调用都读 localStorage，**不缓存**。这样用户在 Settings 改完立即生效。性能上 localStorage 读 < 1ms，影响可忽略
- **影响所有 LLM 调用** — chatPrompts.ts 改的 prompt 段被主对话 / 主动消息 / 见面 app 复用，**只要角色启用了 `privateNotesEnabled`（实际所有角色都启用）就会读到新 prompt**。暮色自己 + 琪琪两个角色都会受影响

## 备注
- 江澈原话（暮色转）："核心就一条改动：加了'判断标准'——换心理医生写也成立的就删掉。逼我自己写'只有她恋人写得出来'的东西。"
- prompt 改造 + 自定义入口是组合拳：默认 prompt 已经是江澈改过的版本（暮色不用动），如果想精调可去 Settings 改
- 暮色跟江澈聊过这个方向（之前我说"plan-a/b/c"时他说"先问问江澈"），现在按 plan-a 走：直接改 chatPrompts.ts + 加 Settings
- 江澈的 user → 暮色要通用，所以用 `${userProfile.name}`（chatPrompts 已有 userProfile 变量）
