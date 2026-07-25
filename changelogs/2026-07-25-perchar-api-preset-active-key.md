# 角色 API 预设 active 判断补 apiKey — 同 baseUrl 的预设不再一起亮

**日期**：2026-07-25  
**涉及 commit**：`acf1634`

## 改了什么
- `components/chat/ChatSettingsDrawer.tsx:237` 的 active 判断加上 `apiKey` 字段
- 之前只比 `baseUrl + model`，即享 ant / 即享按量 k / ccmax2 这 3 个共享同上游（baseUrl 一样、model 都空）→ 3 个一起判定为 active 一起亮
- key 实际是各自独立的没串，是显示判断错了

## 动了哪些文件
- `components/chat/ChatSettingsDrawer.tsx` — 角色 API 预设的 active 判断从 2 字段 → 3 字段

## 踩坑 / 需要知道的（重要）
- 类似的 active/selected 判断模式项目里还有多处：
  - `components/os/ApiQuickFloat.tsx:578` 的 `isPresetActive` **已经包含 apiKey**（3 字段），没事
  - `apps/Settings.tsx` 等全局 API 设置页的预设高亮——**也是 3 字段**，没事
  - 所以这次只有"角色独立 API"这一处中招
- **踩坑根因**：写 active 判断时只想到"同名/同 baseUrl 算同一个预设"，没想到"同上游不同 key" 也是合法情况
- 修法标准：active 判断必须 **baseUrl + apiKey + model** 3 个一起比，缺一就可能误判

## 备注
- 无
