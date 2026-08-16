# 2026-08-16 小纸条总开关

暮色 8-16 反馈："小纸条开关在哪？"——之前 todo 列了但没做。

## 涉及改动

### 1. `utils/chatPrompts.ts`

**新增**：
- `XIAO_ZHI_TIAO_ENABLED_STORAGE_KEY = 'sullyos_xiaoZhiTiaoEnabled'`
- `isXiaoZhiTiaoEnabled(): boolean` —— 读 localStorage，未设时默认 `true`

**改 prompt 拼接逻辑**（908 行）：`${!isPureMode ? ...` → `${!isPureMode && isXiaoZhiTiaoEnabled() ? ...`，关闭时整段"📝 小纸条"prompt 不拼到请求体里。

### 2. `hooks/useChatAI.ts`

**import** 新增 `isXiaoZhiTiaoEnabled`（3153 行）。

**改小纸条解析守卫**（3153 行）：
```js
if (!allowXiaoZhiTiaoParse || !isXiaoZhiTiaoEnabled()) {
    aiContent = aiContent.replace(/\[\[XIAO_ZHI_TIAO:[\s\S]*?\]\]/g, '').trim();
}
```

关闭时 AI 即使输出了标记（理论上 prompt 段不给了不应该有），也会被剥掉，不入库。

### 3. `apps/XiaoZhiTiaoPage.tsx`

**import** 新增 `XIAO_ZHI_TIAO_ENABLED_STORAGE_KEY`。

**加 state + handler**（SettingsDrawer 内）：
- `xztEnabled: boolean`（默认 true）
- `handleToggleXztEnabled(next: boolean)` —— 写 localStorage + 提示

**加 UI section**（在"搜索"section 之前）：
- 标题："小纸条"
- 说明："关闭后：AI 不再写小纸条，prompt 段也不发给模型（连请求体里都没有），已写的小纸条还在。"
- iOS 风格 toggle 按钮（44×24，绿/灰）

## 行为

- **开启**（默认）：现有行为不变
- **关闭**：
  - `chatPrompts.ts` 拼 system prompt 时跳过"📝 小纸条"段
  - 请求体里**不包含**小纸条指令（省 token + 防止 AI 误写）
  - `useChatAI.ts` 解析时即使有 `[[XIAO_ZHI_TIAO:...]]` 也剥掉不入库
  - 已写的小纸条**还在**（localStorage / IDB 都不动）
  - 重新开启后恢复

## 涉及文件

- `utils/chatPrompts.ts` — 加 key + 函数 + 改 prompt 拼接
- `hooks/useChatAI.ts` — 改解析守卫
- `apps/XiaoZhiTiaoPage.tsx` — 加 state + handler + UI toggle
- `changelogs/2026-08-16-xiaozhitiao-master-toggle.md` — 本文件

## 工作流

- 先推 preview，暮色手机端测 OK 后再 merge master
- **不直接推 master**（暮色 8-16 15:53 反馈纠正）
