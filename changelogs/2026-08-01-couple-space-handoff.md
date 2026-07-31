# 情侣空间 handoff — 下一个窗口接着看这里

> 暮色 2026-08-01 00:44 让写的接续文档
> 当前 origin/preview HEAD = `3200b4b`（本窗口最后 commit）
> 写这文档的人（这个窗口的 Mavis）已经把上下文吃满了，下个窗口直接看这里

---

## TL;DR

情侣空间第一阶段（**功能**）还差 3 个模块没做（**时间线 / 悄悄话 / AI 主动打卡**），**打卡模块已经完整**（commit `6f18457`）。

暮色优先级明确：**功能 → 布局 → 默认样式 → 美化**。所以下个窗口应该接着做这 3 个功能模块，**不要碰布局/样式/美化**（那些是后面阶段的事）。

---

## 已完成（最近 14 个 commit）

按时间倒序，每个对应一个明确的暮色反馈：

```
3200b4b  docs: 情侣空间 AI 真决策 changelog + 索引
b168584  feat: 情侣空间 AI 真决策（LLM 完整请求体）+ 状态胶囊带名字
dafd4ed  docs: 聊天页 TDZ 崩溃 changelog + 索引
4d03b3f  fix: 修 TDZ — coupleSpaceInviteResolved useEffect 移到 reloadMessages 之后
a8213cf  docs: 情侣空间接受/拒绝 UI 反馈 changelog + 索引
ecd04e0  fix: 接受/拒绝按钮给反馈 + 卡显示已接受/已拒绝状态
a4e93fb  fix: 邀请卡发送者修对 + 暮色主动邀请后调 LLM 让角色回应
51b1818  fix: 删 requestCoupleSpaceDecision 函数 — 排除任何隐藏路径自动开通
eb29d00  fix: 4 反馈（卡片加发送者/渐变加强/不自动 AI 决策/删 resetToPending）
6d2d4bf  fix: 3 bug（卡片不渲染/CharSelectForInviteModal 缺定义/让 ta 邀请我无选角色）
28b7bf8  feat: 接受不跳空间 + 50 条上下文 + 让角色邀请我
fb464cb  fix: 加 requestCoupleSpaceDecision 到 OSContext value + 用 jumpToChat
690e6e2  fix+feat: 修 2 个 bug + 完整 AI 决策（B 版，暮色选 B 直接做完）
9a6b59e  feat: 完整 miya 邀请流程 — pending/accept/decline + 手动接受
```

最关键的两个 commit（**下个窗口必须知道**）：

- `b168584` — `decideCoupleSpaceInvite(charId, scenario, annivDate)` 函数实现了**真** AI 决策。**失败 fallback 是 `null`（保持 pending），不是默认 accept**。暮色要的"不点就不开通"由这里保证。
- `ecd04e0` — 接受/拒绝按钮点完会同步更新 message 的 `metadata.status='accepted'/'declined'`，dispatch `coupleSpaceInviteResolved` 事件让 Chat reload，卡变状态胶囊（"X 已接受"绿 / "X 已拒绝"灰）。

---

## 未完成（按暮色优先级）

### 第一阶段：功能（**重点**）

- [ ] **时间线模块**（type: `CoupleTimelineItem` 在 `types.ts:455` 附近，storage 已在 `utils/coupleSpaceStorage.ts` 实现）
  - 手动添加（用户 / 角色）
  - 从记忆宫殿抽（AI 抽取，自动去重用 `timelineHasContent` 函数）
  - 列表展示（按日期倒序，软上限 200 条 `trimTimeline`）
- [ ] **悄悄话模块**（type: `CoupleWhisper` 在 `types.ts:455` 附近，storage 已有 `addWhisper`/`markWhispersRead`）
  - 列表 + 输入
  - 已读/未读（`whisperUnread` 字段，消息气泡红点）
  - 角色主动留（proactive 通道）
- [ ] **AI 主动打卡**（30% 概率/天最多 3 条/距上次主动 > 6 小时，`shouldTriggerAiCheckin` 已实现）
  - 接到 proactive 通道
  - 角色主动打卡后推系统消息（`type: 'couple_space_event'`）
- [ ] **用户打卡要不要发消息**（待暮色定）

### 第二阶段：整体布局重做

暮色不喜欢现在图三的布局，**等第一阶段功能做完后**再讨论。

### 第三阶段：去掉粉色

暮色 2026-07-31 明确反馈"不喜欢粉色"。当前情侣空间到处都是 rose/pink：
- 卡片 `bg-rose-100/200`, `border-rose-200/300`
- 按钮 `bg-rose-400`
- 邀请卡渐变 `from-rose-200 via-rose-50 to-pink-200`
- 设置弹窗 `text-rose-*`

**等第二阶段布局重做时一起改**，**别现在动**——动早了跟后面布局重做会冲突。

### 第四阶段（暂放）：配色可调 + 杂志风 + 主题切换

暮色明确说"暂放"，**不要主动提**。

### 独立任务：音乐模块

接 `music.miruis.top` 第三方网易云 API + 备胎方案（多域名轮询 + 自定义 URL + 失败提示）。**与情侣空间无关**，等情侣空间做完再开。

---

## 关键约束（暮色反复强调的，违反就反复返工）

### 设计审美

- **不要粉色**（`rose-*` / `pink-*`）— 暮色 2026-07-31 明确反馈"UI 这个粉色卡片太土了，而且我不喜欢粉色"
  - 用马卡龙其他色：薄荷绿、奶油黄、淡蓝、浅紫
  - **但**：当前阶段（第一阶段功能）情侣空间还是粉的，**先别动**——等第二阶段布局重做时一起改
- **简洁干净清新**——不要花哨阴影/渐变/动画
- **浅色马卡龙色系**为主，圆角、**胶囊按钮**（`rounded-full`）
- **底部按钮居中**（不要 right 对齐）
- **弹窗**：项目级 `components/os/Modal.tsx`，max-w-sm + rounded-[2.5rem] + max-h-[80vh]（不是 h-[80vh]）

### 工作流

- **不要简化**（暮色说"照抄 X" = 照抄 X 的所有核心步骤，不要自作主张砍步骤）
- **不调用 `requestCoupleSpaceDecision`**（已删，暮色不要自动 AI 决策）
  - 用 `decideCoupleSpaceInvite`（fallback null，不自动 accept/decline）
- **不引入新库**（package.json 里没有先问暮色）
- **每次回复末尾列未完成 todo**（暮色 2026-07-31 明确要求）
- **全中文沟通**（暮色英文不好）
- **强刷浏览器提醒**：PWA / service worker 会缓存旧 bundle，暮色测的时候提醒他 `chrome://serviceworker-internals/` → Unregister SullyOS SW

### commit + 报告

- 在 `preview` 分支改，**不要**主动 push 到 `master`
- 中文 `feat:` / `fix:` / `docs:` / `refactor:` 前缀
- 每次任务建 `changelogs/YYYY-MM-DD-<name>.md`
- 在 `AGENTS.md` 的"最近报告"表格加一行索引

### 关键 TDZ 教训（参考 memory 7/31 条目）

- 加 useEffect 前先 `grep -n "useState\|useCallback\|useEffect" <文件>`
- 新 useEffect 位置 > 它**直接引用的所有 const** 的声明位置
- deps array 在 render 时立即求值，跟闭包体一样严
- 删 useState / interface prop / 函数 destructure prop 前必 grep 全部引用点（Vite/esbuild 不做 TS 类型检查）

---

## 未确认的 bug（暮色测过要反馈）

### 暮色 21:40 反馈"让 ta 邀请我 10 几秒就开通"

暮色测的可能不是 51b1818 部署版本（Vercel 部署慢 + 没强刷）。

b168584 改的 `decideCoupleSpaceInvite` 失败 fallback 是 `null`（保持 pending），应该修好这个 bug。**下个窗口要确认暮色在 b168584 后再测一次**。

**验证步骤**（让暮色执行）：
```
1. 情侣空间 → 齿轮 → 解除江澈空间
2. 强刷浏览器（Android Chrome → chrome://serviceworker-internals/ → Unregister）
3. 关掉所有 SullyOS 标签页重开
4. 测"让 ta 邀请我" → 选江澈
5. 等 60 秒
6. 应该看到邀请卡（LLM 接受时）或 "我跟你还不熟..." 拒绝消息（LLM 拒绝时）
7. 不点接受/拒绝 → 状态保持 pending → 情侣空间主页不应该有江澈空间
```

如果第 7 步**还是**自动开通了 → 还有 bug，继续查（最可能是 LLM 失败时 fallback 不是 null）。

---

## 关键文件位置（快速定位）

| 内容 | 位置 |
|---|---|
| 情侣空间主 App | `apps/CoupleSpaceApp.tsx` (约 1000+ 行) |
| 打卡模块 | `apps/CoupleSpaceApp.tsx` line 590+ (`CheckinTab`, `CheckinTaskCard`, `Last7DaysStrip`) |
| 邀请流程 | `apps/CoupleSpaceApp.tsx` line 156+ (`handleConfirmInvite`) |
| CharSelectForInviteModal | `apps/CoupleSpaceApp.tsx` line 615+ |
| 邀请卡渲染 | `components/chat/MessageItem.tsx` line 375+ (early return on `type === 'couple_space_invite'`) |
| `decideCoupleSpaceInvite` | `context/OSContext.tsx` line 1959+ |
| `coupleSpaceAccept` / `Decline` | `context/OSContext.tsx` line 1951+ / 1973+ |
| `requestCoupleSpaceInviteFromChar` | `context/OSContext.tsx` line 2095+ |
| 时间线 CRUD | `utils/coupleSpaceStorage.ts` line 333+ (`addTimelineItem` / `updateTimelineItem` / `deleteTimelineItem`) |
| 悄悄话 CRUD | `utils/coupleSpaceStorage.ts` line 399+ (`addWhisper` / `markWhispersRead` / `deleteWhisper`) |
| AI 主动打卡触发 | `utils/coupleSpaceStorage.ts` line 297+ (`shouldTriggerAiCheckin`) |
| 类型定义 | `types.ts` line 405 (`CoupleSpace` interface) |
| 项目级 Modal | `components/os/Modal.tsx` |
| AGENTS.md 报告索引 | `AGENTS.md` line 9 (`## 9. 最近报告`) |

---

## 暮色今晚 / 上午可能继续测的反馈

按他之前的工作模式，**今晚测 b168584 后**最可能反馈：

1. "让 ta 邀请我 10 几秒就开通" — b168584 fallback null 应该修好，但**没确认**
2. "邀请卡状态胶囊位置不对" — 暮色审美很挑剔，状态胶囊可能在某个小细节上他不喜欢
3. "LLM 拒绝的话术不对" — "我跟你还不熟"这种 fallback 文案暮色可能觉得太生硬
4. "b168584 决策后空间主页没更新" — 接受/拒绝后 CoupleSpaceApp gate 视图可能没 reload

如果暮色说任何事**没反应 / 失败 / UI 错位** —— 第一件事看 Vercel 是不是部署到最新（`b168584`），第二件事让暮色强刷浏览器。

---

## 不要做的事

- ❌ **不要**简化暮色说的"完整机制"（"照抄 miya" = 完全照抄，不是"够用就行"）
- ❌ **不要**用粉色（`rose-*` / `pink-*`）做新 UI（但当前情侣空间还在用，**别动**）
- ❌ **不要**调 `requestCoupleSpaceDecision`（已删函数，要用 `decideCoupleSpaceInvite`）
- ❌ **不要**默认 fallback accept（暮色明确反对）
- ❌ **不要**主动 push 到 `master`（暮色自己合）
- ❌ **不要**承诺自动 AI 决策的"完美判断"——LLM 可能失败要保持 pending 等用户手动
- ❌ **不要**用 Vercel Hobby 10 秒超时做长 LLM 调用（Vercel Hobby 硬限制）
- ❌ **不要**说"好的收到" / "我理解" / "加油"这种套话（暮色讨厌 AI 套话）
- ❌ **不要**在用户反馈时分析太多（暮色要"第一个冒出的想法"，不要"我分析了三条"）

---

## 抄一个 commit message 模板

下个窗口 commit 时照这个格式：

```bash
git commit -m "feat: <一句话标题>

暮色 2026-08-XX 反馈 X 件事：

## 1. <事 1>
根因：<一两句话>
修法：<一两句话>

## 2. <事 2>
...

## 动了哪些文件
- path/to/file.tsx — 简述
- ...

## 踩坑
- <一行说明>

Build 通过：vite X.XXs"
```

---

写完了。暮色 00:44 — 你可以直接把这文件发给下个窗口，或者让我帮你 commit 到仓库。
