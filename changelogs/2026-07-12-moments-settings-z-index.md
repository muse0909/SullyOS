# 朋友圈设置页修复：主页内容透传被盖住

**日期**：2026-07-12
**涉及 commit**：`7e3009d`

## 改了什么
- 朋友圈设置页（`MomentsSettingsPage`）打开时，**主页 MomentsPage 的元素穿透到设置页顶部**：
  - 用户头像 + 名字（封面图上的"暮色"）
  - 签名行（"12334头发"）
  - 顶部工具栏（齿轮、相机按钮）
- 暮色原话："主页中的用户头像和签名出现在了设置页顶上，**不要光看设置页，看看是不是主页中的头像和签名渲染到设置页了**"——暮色预判对了，是渲染叠加。

## 根因（z-index 穿透）
| 元素 | 文件:行 | z-index |
|---|---|---|
| 名字（封面图上） | `apps/MomentsPage.tsx:347-349` | `absolute z-10` |
| 用户头像（封面图上） | `apps/MomentsPage.tsx:352-354` | `absolute z-10` |
| 签名行 | `apps/MomentsPage.tsx:358` | `relative z-10` |
| 顶部工具栏 | `apps/MomentsPage.tsx:301` | `absolute z-20` |
| **设置页最外层** | `apps/MomentsSettingsPage.tsx:84` | **无（z-auto）** ← 锅 |

设置页 `absolute inset-0` 撑满父级（MomentsPage）应该完全盖住，但主页这些元素显式 z-index（10/20）都 > auto（0），所以**穿透**了。

## 修复
- `apps/MomentsSettingsPage.tsx:84` 最外层 div 加 `z-30`
  - 比工具栏 z-20 高（盖住工具栏）
  - 比 SimplePublisher/PostDetailModal z-40 低（modal 仍能盖在设置页上）
  - 跟封面图选项 modal z-30 持平（同层）

只改了 1 行。

## 动了哪些文件
- `apps/MomentsSettingsPage.tsx` —— 最外层 div 加 `z-30`

## 踩坑 / 需要知道的（重要）
- **`absolute inset-0` 撑满父级 ≠ 视觉上盖住父级子元素**。如果父级子元素有显式 z-index，**它们会穿透**到 z-auto 兄弟之上。Z-index 不是"层级深度"而是**同级 stacking order**——同一 stacking context 内，谁的 z 大谁就上。
- **对称检查法**：任何"全屏覆盖"的弹窗/page，**第一件事是给它一个 z-index**。AGENTS.md 5.5 弹窗 Modal 标准 `z-[100]`、本仓库 modal 用 `z-30`/`z-40`/`z-50`——全屏覆盖元素都应该有显式 z-index。
- 暮色这次的预判很准："不要光看设置页，看看是不是主页中的头像和签名**渲染到**设置页了"——下次遇到"全屏元素里看到不属于它的内容"先查 z-index 穿透。

## 备注
- 主页元素（封面图、名字、头像、签名、工具栏）**未改动**——暮色要求"主页中的不动"，符合预期。
- 跟 `changelogs/2026-06-28-buff-popup-portal-fix.md` 的 backdrop-filter 吃 position: fixed 不是同一个问题（这里没看到 backdrop-filter 污染 containing block）。但同一类教训：**全屏覆盖元素必须明确 z-index，必要时上 portal**。
- 待办未变。
