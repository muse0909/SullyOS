# 2026-08-23 小纸条 v3 UI：列表/详情隐藏 + 划线 + 自动 markRevealed

## 改了什么

### components/notes/XiaoZhiTiaoCard.tsx
- import `sanitizeNoteHtml` + 应用 `dangerouslySetInnerHTML`（白名单 `<s>` 标签）
- `revealedAt == null` 时显示 📩 "未拆封"占位（不显示文字内容）
- `revealedAt != null` 时照旧显示内容（划线经 sanitize 后渲染）

### components/notes/XiaoZhiTiaoDetail.tsx
- 加 `onMarkRevealed?: () => void` prop
- useEffect `markedRef`：note.revealedAt == null 时调一次 onMarkRevealed
  - `[note.id]` 依赖：只对每个 note 触发一次（markedRef 防止 React StrictMode 重复调）
- FullXiaoZhiTiaoCard 同款 revealedAt 隐藏 + sanitizeHtml 划线
- 未拆封态：📩 图标 + "未拆封" 文字（详情页 6xl 图标，比列表 3xl 大）

### apps/XiaoZhiTiaoPage.tsx
- XiaoZhiTiaoDetail 调用点加 `onMarkRevealed` 回调：
  - `DB.saveXiaoZhiTiao({ ...selectedNote, revealedAt: Date.now() })`
  - 重新加载 notes → 列表卡片显示文字
- 逻辑：open detail → onMarkRevealed 写 DB → reload notes → 列表卡片显示文字

## 暮色反馈落实

- ✅ "全部列表页没看过的都是不显示文字内容的" — 列表 + 详情统一规则
- ✅ "点开查看过以后才会显示" — 详情 useEffect 自动标 revealedAt
- ✅ "打开即已读"（不滑到底）— useEffect 在 mount 时触发，不依赖任何用户操作
- ✅ "藏的功能体现在不通知" — 列表页没有红点 / 没有折叠图标细节
- ✅ 划线渲染用 sanitizeNoteHtml + dangerouslySetInnerHTML — XSS 安全（只放行 `<s>`）

## 涉及文件

- `components/notes/XiaoZhiTiaoCard.tsx` 列表卡
- `components/notes/XiaoZhiTiaoDetail.tsx` 详情页 + FullXiaoZhiTiaoCard
- `apps/XiaoZhiTiaoPage.tsx` 详情 mount + onMarkRevealed 回调

## 验证

- build 通过（3.84s）
- 老数据：revealedAt 缺省 → 列表显示"未拆封"📩 → 点开 → 自动标 revealedAt → 列表显示内容
- 藏信（HIDDEN）：revealedAt 缺省 → 列表"未拆封"📩 → 点开 → 弹 toast（如有）+ 标 revealedAt
- 定时投递（TIMED）：同上（commit 3 跑通后 revealedAt 缺省 = 未拆封；到期后改 visible 后 revealedAt 仍缺省，列表仍"未拆封"）
- 划线：AI 输出 `[[XIAO_ZHI_TIAO: 今天<s>真好看</s>傻乎乎的。]]` → 渲染"今天 ~~真好看~~ 傻乎乎的。"
- 8 套便签：note.style 字段有值时 XiaoZhiTiaoCard / Detail 应用 className

## 还没做的（commit 5）

- OSContext `discoverUnread` 字段
- 小纸条新 visible 写入时 increment xztVisibleUnread
- 暮色进发现 tab 清零
- WeChat tab bar 渲染红点
