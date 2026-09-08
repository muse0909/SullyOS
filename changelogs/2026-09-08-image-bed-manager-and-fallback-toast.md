# 2026-09-08 图床管理 Modal + fallback 中间 toast + actions 浮层改单页

暮色 9-8 14:50 提了 4 个改动:

1. **任务 B(图床 fallback toast)先做**
2. **任务 A(检测 b64 + UI)入口改到聊天+号里**
3. **批量重传做全选 + 一键全部**
4. **聊天+号浮层(actions panel)改上下滚动一页显示,去掉左右翻页**

## 改了什么

### 1. 任务 B:图床 fallback 中间 toast
- 新建 `utils/imageBedUpload.ts` — 提取 `useChatAI.ts:2431-2497` 的图床上传逻辑
  - 加 onStage callback,每阶段(trying/success/failed)都告诉调用方
  - 优先用 `bedKind` 决定从 imgbb 还是 Cloudinary 开始
- 改 `hooks/useChatAI.ts:2431-2497` 调用 `uploadImageToBed`,传 onStage
  - imgbb 失败 → toast "imgbb 失败,正在试 Cloudinary"
  - Cloudinary 失败 → toast "Cloudinary 也失败,已用 base64 兜底"
  - 都未配 → toast "未配图床"
  - 暮色原话:"imgbb 失败直接弹提醒图床上传失败,实际用时是自动切,改成 imgbb 失败自动切另一个,两个都失败再弹失败提醒"

### 2. 任务 A:聊天+号图床入口
- 改 `components/chat/ChatInputArea.tsx` 的 actions panel:
  - 加 "图床" 按钮(`CloudArrowUp` icon)
  - `onPanelAction('image-bed-manager')` 触发
- 改 `apps/Chat.tsx`:
  - 加 `image-bed-manager` 到 modalType 类型
  - 加 `case 'image-bed-manager'` 到 handlePanelAction
- 新建 `components/chat/ImageBedManagerModal.tsx`:
  - 扫描 messages store 找 (type==='image' || type==='emoji') && content.startsWith('data:image/')
  - 显示列表:缩略图 + 角色名 + 大小 + 时间
  - 单条操作:重传(`<ArrowsClockwise>`) / 删除(`<Trash>`)
  - 批量:全选 / 一键全部上传 / 删除选中
  - 进度条显示
  - 用 raw IDB 改 message.content(因为 DB.saveMessage 只能 add 不能 update)
  - 顶部状态栏显示总条数 + 总大小

### 3. 批量重传(任务 A 子项)
- 在 ImageBedManagerModal 做了:
  - 全选 / 取消全选(顶部按钮)
  - 一键全部上传(底部主按钮)
  - 上传选中(底部主按钮,有选中时)
  - 删除选中(底部次按钮)
  - 进度条(成功 / 失败 / 总数)

### 4. actions panel 改单页
- `components/chat/ChatInputArea.tsx`:
  - 删 `actionsPage` state / `actionsSwipeStart/Move/End/ClickCapture` handlers
  - 删 page 1 div (MCD / HTML)
  - 删底部翻页指示器
  - 删外层 `onTouchStart/Move/End/ClickCapture` 4 个事件
  - 把 MCD / HTML / 图床 都合并进单页 grid
  - 改 `overflow-y-auto` 为 `overflow-y-auto no-scrollbar` 上下滚动

## 关键设计

- `uploadImageToBed` 工具函数支持 `onStage` callback,调用方在每个阶段能拿到通知
- `bedKind` 字段(8-25 暮色 3 tab)决定优先从哪个图床开始
- ImageBedManagerModal 不通过 ChatModals,独立组件,直接用 useOS() 拿 characters
- 用 raw indexedDB 操作 messages 表(DB.saveMessage 只能 add,改内容用 put)
- 工具函数 + 中间 toast + Modal 三个独立模块,任何一处都能复用

## 涉及文件

- `utils/imageBedUpload.ts` (新建, 95 行)
- `components/chat/ImageBedManagerModal.tsx` (新建, 286 行)
- `components/chat/ChatInputArea.tsx` (改 actions panel + 翻页)
- `apps/Chat.tsx` (加 modalType + 渲染)
- `hooks/useChatAI.ts` (改用工具函数 + 中间 toast)

## build

- `npm run build` ✓ 0 错误
- 打包 `dist/assets/index.BQblHuBw.js` (4,889 KB)
