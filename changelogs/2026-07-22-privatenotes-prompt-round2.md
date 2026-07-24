# 私密记事 — 第二轮调整（位置 + prompt 通用化 + 输入框间距）

**日期**：2026-07-22
**涉及 commit**：pending
**前置**：`c46aec4`（第一轮 UI 4 bug + 江澈版 prompt + Settings 入口）

## 改了什么

### 1. 自定义入口位置修正
暮色反馈：自定义 prompt 不该放全局系统设置（`Settings.tsx` 8.5 section），应该放**私密记事自己的设置抽屉**（PrivateNotesPage 顶部齿轮打开的右侧抽屉，跟"搜索/背景"放一起）。

操作：
- 删 `Settings.tsx` 8.5 section（注释 + state + 2 个 handler + import）
- 在 `PrivateNotesPage.tsx` SettingsDrawer 底部"背景区"下面加新的「AI 写小纸条的指导」section
- 文案改通俗：标题「AI 写小纸条的指导」（不再是"私密记事提示词"这种工程名）
- placeholder 改「留空 = 用默认」（简洁，不夹英文）
- 描述用白话写「留空用默认。想让 AI 按你希望的方式写，就在这里改」，不再引 `utils/chatPrompts.ts` 文件路径

### 2. 默认 prompt 通用化
暮色原话：「**判断标准**块是江澈的想法，不能代替所有 AI，要通用的」「**语气示例**要符合角色人格性格，不要通用模版」

新版默认 prompt 关键调整：
- ❌ **删除**：「判断标准（最关键的一条）」块（含"换心理医生写也成立 → 删掉"原话）— 这是江澈私人化的强标准，不通用
- ❌ **删除**：「它不是什么」4 条 ❌（江澈列的心理分析/复盘/自我检讨/防御机制清单）— 太具体
- ❌ **删除**：「语气」块里 3 个私人例子（"修 bug 修到六点""叫我名字声音软的""想吃麻辣烫"）— 这些是暮色跟江澈的细节
- ✅ **改写**「核心精神」块（替代"判断标准"）：
  - "站在'你'的角度写，不是观察者/分析者"
  - "写'我感受到了什么 / 我想到了什么'，不写'她在想什么 / 她为什么这样做'"
  - "想象 ${userProfile.name} 拆开纸条那一瞬间的反应——是会心一笑/心里一软/脸红/小得意，不是被分析了一遍"
  - "语气按你的人物性格来——你平时怎么跟她说话的，纸条就怎么写"
- 保留"它是什么"4 条（通用化）+ 触发时机 + 写完后注意点

暮色会自己把"判断标准"（江澈个人风格强标准）写到自定义里 — 不该强加给所有 AI 角色。

### 3. 详情页输入框底部间距
暮色反馈：图三显示输入框和 Tab Bar 之间留了空隙，要"紧贴父标签栏上面"。

根因分析（写下来下次不踩）：
- 父 WeChat 用 `flex-col` + 内容区 `flex-1` + 底部 Tab Bar `shrink-0` — **WeChat 自己已经把 Tab Bar 高度让出去了**
- NotebookDetail 在 WeChat 的内容区里，**已经享受高度避让**
- 之前 80px 兜底（`pb-20` + `calc(5rem + env(safe-area-inset-bottom))`）是**过激反应** — 父级已经处理好了，不需要 NotebookDetail 再兜底
- 改回原版 `max(0.75rem, env(safe-area-inset-bottom))` = 12px + iOS safe-area（`pb-3` 类）

## 动了哪些文件
- `apps/Settings.tsx` — **删** 8.5 section + state + 2 handler + import（4 处 edit）
- `utils/chatPrompts.ts` — 默认 prompt 段（`!isPureMode && char.privateNotesEnabled !== false` 块内）
- `components/notes/NotebookDetail.tsx` — 底部输入框 `paddingBottom` 80px → 12px
- `apps/PrivateNotesPage.tsx` — SettingsDrawer 加自定义 prompt section + import PRIVATE_NOTES_PROMPT_STORAGE_KEY

## 踩坑 / 需要知道的（重要）
- **不动父级 WeChat 布局就改内部 pb** — 父 WeChat 已经做了 Tab Bar 避让，子级 NotebookDetail 只需要 safe-area 兜底。第一次我以为是 NotebookDetail 没让位加了 80px，结果反而过大。**下次涉及父子 flex 布局，先确认父级是不是已经处理过**
- **prompt 默认要通用** — 江澈的"判断标准"是个人风格要求，不该写进默认 prompt 让所有 AI 都收到。暮色（用江澈时会自己加）和琪琪（其他角色）会有不同需求
- **改 prompt 段不影响"提醒"等其他 trigger 机制** — 触发时机（触动/6 小时/节日/system 提醒）保留，跟私人"判断标准"无关

## 备注
- 暮色具体反馈点：
  1. 自定义入口放错位置（要放私密记事自己的设置）
  2. 介绍文案太专业
  3. 输入框和底部距离太大
  4. 默认 prompt 里的"判断标准"块是江澈私人化，不通用
  5. "语气示例"是私人例子，不要硬塞
- 这次改完，暮色跟江澈聊几次后觉得不够强可以自己在私密记事设置里加"判断标准"那块
- input/底部空隙问题属于"**父 flex 已经处理，子级再兜底就过头**"的经典误判，changelog 写了根因下次不踩
