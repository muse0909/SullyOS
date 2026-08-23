# 2026-08-23 小纸条 v3 定时投递触发

## 改了什么

### utils/xiaoZhiTiaoStyles.ts
- 新增 `checkAndDeliverTimedXiaoZhiTiaos(charId, charName, addToast?)` 函数
  - 读 `DB.getXiaoZhiTiaos(charId)` 过滤 `visibility === 'hidden' && isTimed && hiddenUntil <= now`
  - 改 `visibility: 'visible'` + 写 DB + `addToast(\`${charName} 投递了一张小纸条\`, 'bell', 3000)`
  - 失败静默
  - 返回已投递数（int）
- 顺手修 sanitize 函数 typo（`/</g, '&gt;'` → `/> /g, '&gt;'`）

### hooks/useChatAI.ts
- import `checkAndDeliverTimedXiaoZhiTiaos`
- 在 5.9d（XIAO_ZHI_TIAO 解析）**之前** await 调一次
- 每次主消息回复前都跑（成本 = 1 次 IDB 读 + 几次写）

### context/OSContext.tsx
- import `checkAndDeliverTimedXiaoZhiTiaos`
- 在主动消息拿到 aiContent（sanitize 之后）调一次
- 跟 useChatAI 同款 — 顺带触发

## 简化版说明

**不调度 schedule**（避免引入新基础设施）。在主消息流入口（主聊天 + 主动消息）**顺带检查**。

**优缺点**：
- ✅ 不引入新基础设施
- ✅ 失败静默（跟日记 / 主动消息约定一致）
- ❌ 用户长时间不跟角色聊时，到期藏信不会自动推送
- 后续优化（如果暮色在意）：加 ProactiveDiary 风格的 schedule 触发

## 涉及文件

- `utils/xiaoZhiTiaoStyles.ts:78-114` sanitize + checkAndDeliver
- `hooks/useChatAI.ts:3281-3285` import + 调用
- `context/OSContext.tsx:1967-1971` import + 调用

## 验证

- build 通过（3.88s）
- 测试：手动写个 `_TIMED: ${now+5s}` 纸条（用控制台 `DB.saveXiaoZhiTiao`），5 秒后跟角色聊天 → 触发 `checkAndDeliverTimedXiaoZhiTiaos` → 改 visibility + 弹"X 投递了一张小纸条"
- 测试 TIMED 过期：写个 `_TIMED: ${now-1h}` → 解析时走"立即可见"兜底（不是 hidden，是 visible）

## 测试方法（暮色可手动验）

```js
// 控制台：
const { DB } = window.__SULLYOS_DB__;
const now = Date.now();
await DB.saveXiaoZhiTiao({
  id: 'test-timed-' + now,
  charId: 'char-xxx',  // 替换成你的角色 id
  timestamp: now,
  content: '这是一封 5 秒后投递的测试纸条',
  visibility: 'hidden',
  isTimed: true,
  hiddenUntil: now + 5000,
  style: 'note-pink',
});
// 5 秒后跟该角色说一句话，主消息回复前会触发 checkAndDeliver，弹 toast
```
