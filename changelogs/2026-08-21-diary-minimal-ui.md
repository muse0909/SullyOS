# 日记 v1 步骤 3：最小 UI（"现在让 TA 写一篇"按钮 + 列表兼容 char-only）

## 背景

SullyOS 日记 v1 步骤 3：在 JournalApp 加"现在让 TA 写一篇"按钮 + 列表渲染兼容 `source: 'char-only'` 日记（不写 userPage，只写 charPage）。

## 改动文件

### `apps/JournalApp.tsx`

**1. import**（顶部）
```ts
import { generateCharDiary } from '../utils/charDiary';
```

**2. state**（删除按钮 state 后面）
```ts
const [isGeneratingDiary, setIsGeneratingDiary] = useState(false);
```

**3. handler**（`handleCharSelect` 后面）
```ts
const handleGenerateCharDiary = async () => {
    if (!selectedChar || isGeneratingDiary) return;
    if (!apiConfig.apiKey || !apiConfig.baseUrl) {
        addToast('请先在系统设置里配置 API', 'error');
        return;
    }
    setIsGeneratingDiary(true);
    try {
        const newEntry = await generateCharDiary(selectedChar, apiConfig, { userProfile });
        setDiaries(prev => [newEntry, ...prev].sort((a, b) => b.date.localeCompare(a.date)));
        addToast(`${selectedChar.name} 写好了一篇日记`, 'success');
    } catch (e: any) {
        addToast(`生成失败: ${e?.message || String(e)}`, 'error');
    } finally {
        setIsGeneratingDiary(false);
    }
};
```

**4. 顶栏加按钮**（"写今天的日记" 按钮后面）

新按钮（紫色虚线 + Sparkle 图标 + "现在让 TA 写一篇"）：
```tsx
<button
    onClick={handleGenerateCharDiary}
    disabled={isGeneratingDiary}
    className="w-full py-4 mb-8 border-2 border-dashed border-indigo-200 rounded-2xl text-indigo-500 font-bold flex items-center justify-center gap-2 hover:bg-indigo-50 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
>
    {isGeneratingDiary ? (
        <><div className="w-4 h-4 border-2 border-indigo-200 border-t-indigo-500 rounded-full animate-spin"></div> 写作中...</>
    ) : (
        <><Sparkle size={18} weight="fill" /> 现在让 TA 写一篇</>
    )}
</button>
```

**5. 列表项兼容 char-only**（diaries.map 里）

```ts
const isCharOnly = d.source === 'char-only' || (!d.userPage && d.charPage);
const preview = d.userPage?.text || d.charPage?.text || '(空)';
```

- char-only 显示**紫色**左条 + 紫色日期块 + "TA 的日记" badge
- 点击 char-only 卡片 → toast "TA 的日记详情页稍后提供"（步骤 4 上）
- 老的交换日记**行为不变**

## 风险

- **JSON 解析失败**：LLM 不严格输出 JSON 时，miya 3 重容错兜底（content=raw text）。最坏情况是日记内容不是干净文本，**但不会 crash**
- **API 配置缺失**：handler 提前检查 `apiConfig.apiKey` / `baseUrl`，给 toast 提示
- **同一天再点**：`generateCharDiary` 内部抛 "今天已经写过日记了"，catch 后给 toast 错误提示

## 你需要测的

打开 JournalApp → 选江澈（角色最多的）：
1. 点"现在让 TA 写一篇" → 看到加载 → 完成后弹 toast + 列表出现紫色新卡片
2. 卡片内容：标题、心情、750-850 字正文都正常
3. **再点一次**按钮 → toast "今天已经写过"
4. 点删除 → 卡片消失
5. 老的交换日记还在，**没坏**

## 不在本轮做的

- tab 切换（"交换日记" / "TA 的日记"）— 步骤 4
- 详情页（char-only 点击进详情）— 步骤 4
