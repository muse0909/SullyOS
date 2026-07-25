# 聊天记录恢复全 mode 按 ID 合并 — 修多端同步被覆盖

**日期**：2026-07-25  
**涉及 commit**：`d6c2753`

## 改了什么
- `utils/db.ts:1862-1873` 的 messages 处理：所有 mode（text_only / full / media_only）都按 ID put，**不再 `store.clear()`**
- 之前：`text_only` 走 patch mode（合并），`full` / `media_only` 走 `store.clear()` 整库替换
- 现在：所有 mode 一律按 ID put（idempotent）

## 改之前的问题（暮色 7/25 反馈）
- 时间线：
  1. phone A 11:00 上传完整备份到云端
  2. phone B 11:00 从云端恢复（phone B 11:00 状态 = phone A 11:00）
  3. phone A 跟 TA 11:00-12:00 麦麦窗口聊 5 轮（phone A 12:00 状态 = 11:00 + 5 轮）
  4. phone B 12:00 上传完整备份（江澈 11:00-12:00 聊了 3 轮，麦麦没新）
  5. phone A 12:00 从云端恢复 phone B 12:00 备份
  6. **phone A 麦麦窗口的 5 轮被覆盖没了** ← 暮色撞上

## 改后行为
- 本地有同 ID 的消息 → 跳过（保留本地版本）
- 本地没有的 ID → put（合并新内容）
- 不管用轻量同步还是完整同步，逻辑都一样

## 动了哪些文件
- `utils/db.ts` — messages 处理块，删 `isPatchMode` 判断和 `store.clear()`

## 踩坑 / 需要知道的（重要）
- **副作用：失去「整机恢复 messages」语义** — 如果用户想"完全替换本地 messages"（比如从零开始），得先去 Settings 危险区手动清空聊天记录再恢复
- 实际场景：多端同步 > 单向恢复，这个 trade-off 暮色接受
- **只改了 messages** — 其他 store（diaries / tasks / anniversaries / groups / worldbooks 等）保持原样（full 模式还是整库替换）。暮色目前没撞上那些，后续撞上再扩
- IDB put 是 idempotent — 同一主键多次 put 不会创建多条记录，只更新已有那条（这是合并能正确工作的前提）

## 备注
- text_only 模式原本就是按 ID 合并，本次改对它无影响
- full 模式之前是"整机替换"，现在改成"合并"——这是行为变更，暮色明确同意
- 没改 `characters` store — text_only 已经做"本机有则跳过"，full 保持整库替换（角色卡是配置类，不是增量内容）
