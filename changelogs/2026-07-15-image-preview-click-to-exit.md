# 聊天图片预览支持单击/双击图片退出

**日期**：2026-07-15
**涉及 commit**：`49a7bc3`

## 改了什么

**用户视角**：
- 聊天页点图片 → 进全屏预览（已有）
- 预览状态下：
  - 单击图片 → 退出预览
  - 双击图片 → 退出预览
  - 点黑色遮罩 → 退出预览（已有）
  - 点右上角 X 按钮 → 退出预览（已有）

四种退出手势，**单击图片 / 双击图片是新增的**。

## 动了哪些文件

- `components/chat/MessageItem.tsx` —— lightbox 内 `<img>` 的 `onClick` 改成 `setLightboxUrl(null)`，新增 `onDoubleClick` handler，去掉原来的 `e.stopPropagation()`，加 `cursor-pointer` 视觉提示

## 踩坑 / 需要知道的（重要）

### 1. 之前的实现是**反逻辑**

旧代码 `onClick={(e) => e.stopPropagation()}` 意思是"点图片阻止冒泡到外层遮罩的 onClick"。

- 外层遮罩 `onClick={() => setLightboxUrl(null)}` → 点遮罩退出
- 图片 `e.stopPropagation()` → 点图片**不**退出

意图是"防止点图片误退"，但实际：
- 用户点图片想退出 → 图片不响应，**点图片等于死区**
- 跟用户预期完全相反（点图片应该有什么反应，至少退出）

暮色这次反馈"再点一下图片退出"——**正是把反逻辑改正**。

### 2. 双击 = 单击的副作用，但**显式加 onDoubleClick 防御**

浏览器行为：双击 = 连续两次 click。第一次 click 触发 `onClick` → `setLightboxUrl(null)` → modal unmount → 第二次 click 找不到 `<img>` 元素 → 无效果。

所以**双击 = 单击（自然 work）**。但我**显式加了 onDoubleClick handler**（也调 setLightboxUrl(null)），防止以后改 onClick 行为时双击失效。

### 3. 没改其他退出手势

X 按钮和点遮罩都保留——两种"温和退出"（遮罩 + X）vs 两种"激进退出"（单击 + 双击）都给用户。

### 4. 长按图片保存 / 选文本

移动端长按图片会触发浏览器的 context menu（保存图片 / 复制图片），**不触发 click**。所以"长按保存"跟"单击退出"不冲突。

PC 端同理：右键保存图片不会触发 onClick。

## 备注

- commit `49a7bc3` 已 push 到 `origin/preview`，Vercel 自动部署
- **测试场景**：聊天 → 点任意图片 → 进预览 → 单击图片退出 ✓ / 双击图片退出 ✓
- 改动极小（1 文件 +4/-2 行），影响面只限 lightbox 内图片 click
- 跳转 bug + 朋友圈 AI 配图接通生图 API 仍然按暮色要求**先放着**
