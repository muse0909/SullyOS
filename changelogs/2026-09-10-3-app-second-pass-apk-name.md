# 2026-09-10 第二轮：3 个 App 顶部 paddingTop 再调 + APK 文件名加版本号

暮色 19:18 反馈：
1. 之前调过的 8 个 App 还有 3 个（查手机/见面/彼方）没调整过来
2. APK 文件名下次写上版本号"拾光机-xxxx"
3. 开屏白屏问题查清楚回给（**先不打 APK**，等开屏修好再一起打）

## 改动

### 1. 查手机 (CheckPhone) select 页面头部
- 之前 `h-14`（详情页）OK，但 select 页面 line 717 是 `h-20 pt-4` (96px) — 头部过高
- `apps/CheckPhone.tsx:717`: `h-20 pt-4` → `h-14 pt-2` (64px) 让标题贴紧状态栏下方
- 详情页 line 393 `h-14` 保持

### 2. 见面 (Date) session 页面
- `apps/DateApp.tsx:751`: 之前 `max(1.25rem, var(--safe-top))` → 改成 `1.25rem`（去 safe-top，因为 App 已 top: 2.5rem）
- `components/date/DateSession.tsx` 还有两处 env paddingTop 漏改：
  - line 859: `paddingTop: calc(env(safe-area-inset-top) + 28px)` → `1.75rem` (28px，去 env)
  - line 885: `paddingTop: max(56px, calc(env + 44px))` → `max(28px, calc(env + 12px))`

### 3. 彼方 (VRWorld) VR_TOP
- 之前改 `VR_TOP = 'var(--chrome-top)'` (= env+2.5rem = ~90px) → `'2.5rem'` (40px) — 还是离状态栏 40px 空
- `apps/VRWorldApp.tsx:27`: `'2.5rem'` → `'0.5rem'` (8px) 让标题贴紧状态栏下方 8px
- `apps/VRWorldApp.tsx:30`: `VR_ROOM_PANEL_TOP = calc(2.5rem + 3.75rem)` → `calc(0.5rem + 3.75rem)`

### 4. APK 文件名带版本号
- `android/app/build.gradle`: 加 applicationVariants 配置
- 输出文件名格式：`拾光机-{versionName}.apk`（debug 加 `-debug` 后缀）
- 例：`拾光机-2026-09-10-6b76cac3-debug.apk`
- versionName 之前已用 `yyyy-MM-dd + git commit hash`

## 不打包 APK
暮色 19:18 要求："这一轮先把前面说的没调整好的改了，不用打包apk，等开屏修好再一起打"

## 验收（下次打包后）
- 查手机 select 页面头部 64px（之前 96px），标题贴紧状态栏
- 见面 session 页面顶部按钮 paddingTop 28px（之前 78px）
- 彼方顶部 paddingTop 8px（之前 90px）
- APK 文件名带版本号