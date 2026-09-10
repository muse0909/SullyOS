# 2026-09-10 8 个 App 顶部 paddingTop 去掉 env + chat header 调窄

暮色 18:45 反馈：
1. **8 个 App**（神经链接/记忆宫殿/世界书/查手机/见面/彼方/小小窝/写歌/存钱罐/都市人生）—— 标题和状态栏之间有很大的空，整体下移太多，没有贴到状态栏
2. **chat header 高度** —— 太高，"稍微调窄一点"

## 根因
之前 PhoneShell App 容器 `top: theme.hideStatusBar ? 0 : calc(env + 2.5rem)`，**包含 env**。
我刚改成 `top: 2.5rem`（**不含 env**），App 从屏顶 40px 起（紧接 StatusBar 下方）。

但这 8 个 App 内部还有自己的 `paddingTop: env` 或 `pt-16` 等**还在加 env** —— **env 被算了两次**：
- PhoneShell App 容器 top: 2.5rem (= 40px)
- App 内部 paddingTop: env (= 50px) 或 `pt-16` (= 64px) 或 `max(40px, env+16px)` (= 66px)
- → 标题位置 = 屏顶 40 + 50 = 90px（远了 50px）

## 改动

### 8 个 App 顶部 paddingTop 去掉 env
1. **Character (神经链接)** — `apps/Character.tsx:962` `pt-16` (64px) → `pt-2` (8px)
2. **MemoryPalace (记忆宫殿)** — `apps/MemoryPalaceApp.tsx:37` `max(40px, calc(env + 16px))` → `16px`
3. **Worldbook (世界书)** — `apps/WorldbookApp.tsx:266` `h-20` (80px) + `pb-3` → `h-14` (56px) + `pb-2`
4. **CheckPhone (查手机)** — `h-14` (56px) — **保留**（不高，OK）
5. **Date (见面)** — `apps/DateApp.tsx:751` `max(1.25rem, var(--safe-top))` → `1.25rem` (20px)
6. **VRWorld (彼方)** — `apps/VRWorldApp.tsx:26` `VR_TOP = 'var(--chrome-top)'` (= env+2.5rem = ~90px) → `'2.5rem'` (40px)
7. **Room (小小窝)** — `apps/RoomApp.tsx:1057` `pt-12` (48px) → `pt-2` (8px)
8. **Songwriting (写歌)** — `apps/SongwritingApp.tsx:1266` `h-24` (96px) + `pb-4` → `h-16` (64px) + `pb-3`
9. **Bank (存钱罐)** — `apps/BankApp.tsx:744` `pt-[calc(env+1.5rem)]` → `pt-4` (16px)；line 874 `pt-[calc(env+0.75rem)]` → `pt-2` (8px)
10. **LifeSim (都市人生)** — `apps/LifeSimApp.tsx:875` `max(12px, env)` → `'12px'`

### Chat header 调窄
- `components/chat/ChatHeaderShell.tsx:192`:
  - 之前：默认 `h-[72px]` (72px)
  - 现在：默认 `h-14` (56px)
  - 紧凑模式：`h-16` → `h-14`，宽松模式：`h-24` → `h-20`
  - 头像在 28px 屏顶居中（40px StatusBar + 28px 居中 = 68px 屏顶）

## 验收
- 8 个 App 标题贴紧 StatusBar 下方（屏顶 40-60px 区域）
- chat header 头像框 56px 高（之前 72px）
- 其他 App（聊天/外观/设置）**不变**（暮色说"其他都是正常的，不用动"）
- 暮色需要重新打包 APK