# 日记容错强化：栈式 JSON 提取 + 顶栏改角色名 + 交换日记同步

## 背景

暮色 8-21 23:18 反馈：
1. 详情页黑框顶栏中间显示的是日期，**应该显示角色名字**
2. 详情页正文以 `{"title":"...","mood":"...","content":"...}` 字面量字符串开头，**没解析成 JSON**——内容是 LLM 输出的 raw text，**整段**被存到 `charPage.text`
3. **交换日记 write 模式**也用同样的"裸 `JSON.parse`"——同样的乱码 + 同样的分行不出来

## 根因

**两处都用 `/\{[\s\S]*\}/` 贪婪正则提取 JSON**。贪婪正则的特性：
- 找到**第一个** `{` 到**最后一个** `}` 的内容
- LLM 输出的 `content` 字符串里如果有未转义的 `{` `}`（比如"今天跑了{3 公里}"），**`JSON.parse` 失败**
- 兜底分支把 raw text 整个塞进 `parsed.text` / `parsed.content`
- 字面量 `{"title":...}` 就直接显示出来，`\n\n` 也作为字面量字符没变成真实换行

## 修复

### 1. `utils/charDiary.ts` — 导出 `stripThinkTags` + `extractJson`（栈式 JSON 提取）

```ts
export function stripThinkTags(text: string): string {
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

export function extractJson(text: string): string | null {
    // 栈式匹配：处理 content 字符串里未转义 { } 的情况
    // 找到第一个 {，用深度计数找到匹配的 }，跳过字符串里的 { }
    const start = text.indexOf('{');
    if (start < 0) return null;
    let depth = 0, inString = false, escape = false;
    for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (escape) { escape = false; continue; }
        if (c === '\\') { escape = true; continue; }
        if (c === '"' && !escape) { inString = !inString; continue; }
        if (inString) continue;
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
    }
    return null;
}
```

**关键**：栈式提取**正确处理**字符串字面量里的 `{` `}`（比如 `content: "我画了个 {猫}"` 不会让外层 `}` 匹配错位）。

`parseDiaryFromApi` 改用 `extractJson` 替换之前的贪婪正则。

### 2. `apps/JournalApp.tsx` — 共享容错到交换日记

```ts
// 之前
content = content.replace(/```json/g, '').replace(/```/g, '').trim();
try { parsed = JSON.parse(content); } catch (e) { parsed = { text: content, ... }; }

// 现在
const cleaned = stripThinkTags(rawContent).replace(/```json/g, '').replace(/```/g, '').trim();
const jsonStr = extractJson(cleaned);
if (jsonStr) {
    try { parsed = JSON.parse(jsonStr); } catch { parsed = { text: cleaned, ... }; }
} else {
    parsed = { text: cleaned, ... };
}
```

import 路径：
```ts
import { generateCharDiary, stripThinkTags, extractJson } from '../utils/charDiary';
```

### 3. 详情页顶栏中间改成角色名

```tsx
// 之前
<h1>{viewingCharOnly.date}</h1>

// 现在
<h1>{selectedChar?.name || ''}</h1>
```

## 风险

- **老坏数据**（之前生成的 raw text）需要**手动删除**——自动清理太复杂，且会动到用户数据
- **新数据**：用栈式提取 + 共享容错，**新生成**的应该都干净

## 你需要测的

1. **手动删掉老的坏数据**（char-only + 老的交换日记如果也有 raw text 问题）
2. 重新生成一篇 char-only → 详情页应该**没有** `{"title":...` 字面量，换行正常
3. 写一篇新的交换日记（用户写 + 角色回复）→ 回复内容应该**没有** `{"text":...` 字面量，换行正常
4. 详情页顶栏中间显示**角色名**（不是日期）

## 不在本轮做的

- 自动清理老坏数据（风险太大）
- 通用 JSON 解析模块（暂时直接共享 charDiary 的工具函数即可）
