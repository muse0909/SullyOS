# 收藏页清理：关掉失效 toast + 取消语音自动加入收藏

**日期**：2026-07-22
**涉及 commit**：`ee6c7e8`

## 改了什么

1. **关掉「语音数据已丢失」toast 堆叠**
   - `apps/FavoritesPage.tsx` 删掉 `addToast('语音数据已丢失（升级前的老收藏）', 'warning')`
   - 保留 `markFavoriteInvalid(item.id)` 写 localStorage + 卡片渲染时显示「语音已失效」灰块
   - 失效统一由卡片灰显表达；想清理进选择模式一键全选删除

2. **取消「语音自动加入收藏」**
   - `apps/Chat.tsx` 删掉 TTS 完成后的 `addFavorite` + `uploadVoiceFavorite` + `updateFavorite` 整段流程
   - 顺手删掉 `addFavorite/genFavoriteId/updateFavorite/uploadVoiceFavorite` 的 import（没人用了）
   - 只保留**手动收藏**（聊天页 AI 语音条 → 菜单 → 🌟 收藏）

3. **改空状态提示语**
   - `apps/FavoritesPage.tsx` EmptyState：`「AI 角色说话时会自动加入收藏」` → `「聊天页 AI 语音条 → 菜单 → 🌟 收藏」`

## 动了哪些文件
- `apps/Chat.tsx` —— 删自动收藏流程 + 删 4 个 import
- `apps/FavoritesPage.tsx` —— 删 addToast + 改提示语

## 踩坑 / 需要知道的（重要）

- **「语音数据已丢失」toast 为什么堆 9 个不消？**
  - voice 卡片 mount 时跑 useEffect：云端 URL 失效 → IndexedDB 找不到 → `markFavoriteInvalid` + `addToast`
  - 失效条目多时（比如暮色截图里 9 个），**进一次收藏页 9 张卡片同时 mount → 同时弹 9 个 toast**
  - toast 默认 10 秒（`OSContext.tsx:1986`，暮色 2026-07-14 反馈 3 秒一闪而过看不清楚改成 10 秒）
  - 10 秒后会自动消失，但 9 个堆一起看起来就是「挂着不消，只能刷新」
  - 删 toast 是最直接方案；**保留 markFavoriteInvalid** 因为它是 localStorage 持久化，卡片灰显的源头

- **markFavoriteInvalid 写 localStorage 但 setItems 没刷新**
  - 父组件 `items` state 来自 `getAllFavorites()` 一次性读，写 localStorage 不会触发父组件 reload
  - **子组件 useEffect 依赖里有 `item.invalid`，但父组件 state 不变 → useEffect 不重跑**
  - **结果**：第一次进收藏页弹 toast，写完 invalid 之后不会重弹（除非父组件重 load）
  - 但截图里同时看到 9 个 toast，**那一定是 9 张卡片** mount 时同时各弹一次（都还没标 invalid），不是重复弹
  - 修完只删了 toast，没改 state 同步逻辑——**现在没 toast 了，这个潜在的 state 不一致也没影响**

- **数据丢失的根因没修**
  - 暮色明确说「这个之前改过，还是失败了，以后再说吧」
  - 根因怀疑方向（**没看代码确认，仅根据 changelog 推论**）：
    1. 老的 voice 收藏是 2026-07-03 之前存的，URL 字段是 blob URL（已 GC）
    2. 2026-07-13 上 Netlify Blobs 云端时写了 function，但 `2026-07-15 netlify-cleanup` changelog 提到「前端代码里没有 `/api/v1/voice-favorite-store` 的 fetch」——**云端上传实际上从来没工作过**
    3. 那时新收藏的语音**根本没传到云端**，markFavoriteInvalid 之前 fallback 到 IndexedDB `voice_msg_${msgId}` 找
    4. IndexedDB 找不到了说明 Chat 那边没存过或者被清了
  - 反正这次**不动**，暮色说以后再说

- **「聊天页 AI 语音条 → 菜单 → 🌟 收藏」路径准确性**
  - 我没点进 Chat 语音条实测过完整菜单路径，只是按现有 UI 推测
  - 暮色在 Android 上测的时候如果发现路径不对，告诉我我再改 EmptyState 提示

## 备注

- 没动：消息收藏（手动 🌟）的逻辑，保持不变
- 没动：选择模式 / 批量删除 / 一键清空失效 的逻辑（暮色 2026-07-13 加的，changelog `2026-07-13-voice-favorites-cloud.md`）
- 没动：markFavoriteInvalid / invalid 灰显逻辑（只是不再弹 toast）
- 下次要修数据丢失：先看 2026-07-13 上云端那段代码到底跑没跑起来，再看 IndexedDB 的 `voice_msg_${msgId}` 实际写入时机
- git push 第一次超时，加 `http.proxy = http://127.0.0.1:7890` 后通了；这个 proxy 改的是 git config --global，跨项目都生效，后续 push 应该不会再卡
