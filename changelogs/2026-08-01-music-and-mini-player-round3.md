# 一起听 + 迷你播放器 第 3 轮：addListeningPartner 漏 destructure / 一起听中位置 / 迷你播放器重构

**日期**：2026-08-01
**涉及 commit**：（待 commit）
**依赖**：`2026-08-01-music-mi-ya-feedback-round2.md`

## 改了什么

暮色测完上一轮反馈 5 个问题：

1. **一起听 选同伴 点头像无法选中 + 报错** —— `addListeningPartner is not defined`
   - 原因：destructure 时漏写 `addListeningPartner`（只拿了 `listeningTogetherWith, removeListeningPartner`）
   - 修：line 34 destructure 补 `addListeningPartner`

2. **一起听中"摘要"被底部 tab bar 挡住** —— 位置错了（在末尾）
   - 修：把"一起听中"section 从末尾挪到"02 选歌"section 之后、"03 拜访"之前

3. **其他页面的圆形迷你播放器 不能移动** —— **这个其实能拖**（GlobalMiniPlayer 折叠态本来就支持拖动 + 持久化到 localStorage），暮色测的是**展开态**不可拖
   - 修：GlobalMiniPlayer 展开态也支持拖动（共用了折叠态的 onPointerDown/Move/Up + pos 位置），展开态默认位置从 `bottom-3` 挪到 `right-12 bottom-80`（避开 home indicator 和 chat input 框）

4. **聊天页的播放器也改回圆形迷你播放器** —— 之前聊天页用的是 ChatMusicPlayer（顶部固定胶囊，不可拖）
   - 修：删掉 `components/chat/ChatMusicPlayer.tsx`，从 `ChatHeaderShell` 移除引用，PhoneShell 不再排除 Chat/GroupChat —— GlobalMiniPlayer 接管所有非 Music/Launcher/Call 页面

5. **音乐 app 设置中加迷你播放器隐藏开关**
   - 修：UserProfile 加 `miniPlayerHidden?: boolean` 字段；音乐 app 设置页加 toggle row；GlobalMiniPlayer 用 `userProfile.miniPlayerHidden` 替代之前的 sessionStorage 机制

## 动了哪些文件

- `apps/MusicApp.tsx` —— destructure 补 addListeningPartner + 一起听中 section 位置 + 音乐设置页加 toggle
- `apps/music/NeteaseProfilePage.tsx` —— 上一轮已加，本轮未动
- `components/os/GlobalMiniPlayer.tsx` —— 重构：折叠态 + 展开态都支持拖动 + 用 userProfile 替代 sessionStorage + 删掉 X 隐藏按钮（改用音乐设置页 toggle）
- `components/PhoneShell.tsx` —— line 500 改成不排除 chat/groupChat
- `components/chat/ChatHeaderShell.tsx` —— 删 ChatMusicPlayer import + 两处引用
- `components/chat/ChatMusicPlayer.tsx` —— **删除**（用 mavis-trash，可恢复）
- `types.ts` —— UserProfile 加 `miniPlayerHidden?: boolean`

## 踩坑 / 需要知道的

- **改完 div 配对时 esbuild 报 "Unterminated regular expression"**——其实是 JSX div 嵌套错乱（多 3 个 `</div>`），esbuild 错误信息跟真因不一致。用 `ts.createSourceFile().parseDiagnostics` 能直接拿到行号。
- **GlobalMiniPlayer 之前的 `useState(hidden)` + sessionStorage 机制** — 切歌会自动取消隐藏（`useEffect [playing]` 监听 playing 从 false → true）。新版改成 userProfile.miniPlayerHidden 后，**切歌不会自动复活**——更符合暮色"想关就关"的预期。
- **ChatMusicPlayer 删除后** — 之前是聊天页右上角胶囊，**没有头像+封面+拖动**。现在 GlobalMiniPlayer 接管，**默认是小圆球**（40px 圆），需要点击才展开完整控制条。暮色测一下看是不是这个体验。
- **miniPlayerHidden 是用户级设置** — 改完通过 `setUserProfile({ miniPlayerHidden: ... })` 自动持久化到 IndexedDB，下次开 app 状态还在。

## 一起听调研

待做：暮色要"角色能知道我在和他一起听 + 角色自己选歌"。下一轮查 miya/330 怎么做的，给方案。
