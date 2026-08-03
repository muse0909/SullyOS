# 见面 app：聊天快捷键 + 4 按钮布局修复

**日期**：2026-08-04
**涉及 commit**：`待提交`

## 改了什么

### 1. 4 按钮布局修复（暮色反馈 item 7）

暮色反馈"+ 菜单之前是 4 个平铺，现在变 3+1（上面 3 个下面 1 个）"。

- 根因：`<div className="flex flex-wrap">` + 每个按钮 `px-5 py-2.5` 太宽，4 个装不下 → 第 4 个换行
- 修复：改 `grid grid-cols-4 gap-2` 平均分布 4 列，按钮缩小 `px-1 text-[11px] min-w-0`

### 2. 聊天快捷键（暮色选的方案）

暮色选了：**A. 全局共用**（不是每角色独立）+ 第 1 个固定"全屏输入" + 后面自定义 + 输入框上方一排 + DateSettings 管理。

**功能**：
- 全局共用：所有角色共享一套快捷键列表，存在 localStorage `os_date_quick_phrases`
- 数据结构：`DateQuickPhrase { id, display, content, enabled }`
  - **display**：键盘栏显示的字符（emoji / 短文字，默认 = content 截取前 2 个字符）
  - **content**：点击后插入到输入框的文字，**支持多行**
  - **enabled**：开关（关闭不显示但不删除）
- **第一个固定按钮**："全屏输入"（点击打开 FullScreenEditor）—— 从原输入框左边的位置**挪到快捷键栏**第 1 个

**改动文件**：

- `types.ts` — 新增顶层 `DateQuickPhrase` interface
- `context/OSContext.tsx`：
  - 5 个新字段（`dateQuickPhrases` state + 4 个操作函数 + ContextType 暴露）
  - localStorage 同步（每次修改写回 + 触发 window `'os_date_quick_phrases_changed'` 事件）
  - 订阅 `'storage'` + 自定义事件，让 DateApp/DateSettings 跨实例同步
- `components/date/DateSettings.tsx`：
  - 解构 OSContext 的 5 个 quickPhrases 字段
  - 加 modal state（`phraseModalOpen` / `phraseModalMode` / `editingPhraseId` / `phraseFormDisplay` / `phraseFormContent`）
  - 加 3 个 handler（`openCreatePhrase` / `openEditPhrase` / `submitPhrase`）
  - 加「快捷键」section（长文主题 tab 第 1 项）：列表 + 开关 + 编辑/删除按钮
  - 加新建/编辑弹窗：显示（emoji/短文字）+ 填充内容（多行 textarea）+ 预览
- `components/date/DateSession.tsx`：
  - 解构 OSContext 的 `dateQuickPhrases`
  - 在输入框**上方**加快捷键栏：横向滚，第 1 个"全屏输入"按钮，剩下自定义的（按 enabled 过滤）
  - **删除**原输入框左边的"全屏输入"按钮（已挪到快捷键栏）
  - 清理 `CornersOut` import

## 踩坑 / 需要知道的（重要）

- **"显示"和"填充内容"是两个独立字段**（参考 iOS 新建快捷键的截图）：
  - **显示**（display）：emoji 或短文字（最多 4 字符），键盘栏按钮上显示这个
  - **填充内容**（content）：点击后插入到输入框的文本，支持多行
  - 显示默认 = content 截取前 2 个字符，可以单独改成 emoji 当图标
  - **典型用法**：内容是一长串"指令"或"模板" → 显示用一个 emoji 当图标
- **点击快捷键的插入逻辑**（DateSession line 1130）：
  - 输入框**空** → 直接填入 content
  - 输入框**有内容** → 在末尾追加（如果末尾不是换行先加 `\n`）
  - **不**打断光标位置（iOS 有"光标处"选项，暮色没要，先不做）
- **OSContext 5 个新字段**用同一个 localStorage 同步 set 函数（`setDateQuickPhrases`），保证：
  - 写 localStorage 后立即触发 window 事件
  - 其他挂载的实例（DateApp / DateSettings）通过事件订阅 setState
  - 跨浏览器标签也通过 `'storage'` 事件同步
- **快速键修改不依赖"保存当前布置"按钮**：
  - 之前 DateSettings 的"保存当前布置"按钮是给 `char` 字段用的（spriteConfig 等）
  - quickPhrases 走 OSContext 直接同步到 localStorage（**立即生效**）
  - 在 section 里加了提示"第一个按钮是固定的"和"修改后立即生效"
- **删除快捷键**用了 `confirm()` 弹原生确认窗——简单，暮色审美 OK
- **TDZ 风险检查**：
  - OSContext: 我加的 useEffect 在所有 useState/函数定义之后 → 没 forward ref
  - DateSession/DateSettings: 从 useOS() 解构的字段 → 没问题
  - 全部 build 过
- **第一个"全屏输入"按钮的特殊处理**：
  - 不在 `dateQuickPhrases` 数组里（数组只存用户自定义的）
  - DateSession 渲染时**硬编码**在第 1 个位置
  - 点击调 `openFullInput`（跟原来一样）
  - 这样符合暮色"第一个固定"的要求，且不让用户能删/关这个

## 备注

- **样式对齐**：快捷键栏按钮用 `bg-white/15 backdrop-blur-md border border-white/20` 跟当前见面 app 输入区主题一致
- **横向滚动**：用了 `flex gap-2 overflow-x-auto no-scrollbar`（跟其他横向滚组件一样）
- **多行内容预览**：列表里只显示第一行，多行内容会显示"多行内容"提示
- **预留能力**：未来如果用户想要"光标位置"选项（iOS 那张图有"光标位置: 最后"），UI 框架已经搭好，加一个 state + 字段就行
- **不冲突**：
  - 跟现有的 `setInput('')`（发送时清空）独立
  - 跟 `handleResend`（重发最后一条）独立——快捷键**不**触发发送，只插入文字
  - 跟 `isTyping` 锁独立——快捷键栏**总是**可点（用户可以预先输入快捷键然后等 AI 回完再发）
- **未来扩展**（如果暮色要）：
  - 拖拽排序（鼠标长按重排）
  - 分组（按用途分类）
  - 导入/导出（跨设备同步）
