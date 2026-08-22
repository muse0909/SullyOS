# 相册支持 AI 生图来源标记

## 背景

之前相册（`apps/Gallery.tsx`）只存"用户从聊天里手动保存到相册"的图。AI 主动生成的图只写到聊天消息（`type: 'image'`），相册看不到。

暮色 2026-08-21 反馈：希望在角色相册里区分"用户发的图"和"AI 生的图"，后续要加 tab 切换。

本轮先做**数据层 + 写入链路**——为 GalleryImage 加 `source` 字段 + 让 AI 生图自动写相册。**UI 层（tab 切换、角标 chip、下载按钮）下一轮做**。

## 改动文件

### 1. `types.ts:1341` — `GalleryImage` 加 `source` 字段

```ts
export interface GalleryImage {
    id: string;
    charId: string;
    url: string;
    timestamp: number;
    source?: 'user' | 'ai'; // 老数据 undefined 当 'user' 处理
    review?: string;
    reviewTimestamp?: number;
    savedDate?: string;
    chatContext?: string[];
}
```

`source` 标可选：老数据没这字段，反序列化时是 `undefined`。`db.ts` 过滤时把 `undefined` 视作 `'user'`，不影响现有 536 张江澈的用户图。

### 2. `utils/db.ts:913-934` — `getGalleryImages` 加 `source` 可选参数

```ts
getGalleryImages: async (charId?: string, source?: 'user' | 'ai'): Promise<GalleryImage[]> => {
    // ... 原有 charId 索引查询
    request.onsuccess = () => {
        let result = request.result || [];
        if (source) {
            // 老数据 source undefined → 视为 'user'
            result = result.filter(img => (img.source || 'user') === source);
        }
        resolve(result);
    };
}
```

IndexedDB `gallery` store 只在 `charId` 上建了索引，`source` 过滤在内存做。数据量级（角色相册几百张）内存 filter 完全够用。下一轮如果性能有问题再考虑加复合索引 `[charId, source]`。

`saveGalleryImage` 不用改——`put` 整个对象，新字段自然落库。

### 3. `hooks/useChatAI.ts:2356-2365` — AI 生图同步写相册

```ts
if (imageUrl) {
    await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'image', content: imageUrl });

    // 暮色 2026-08-21：AI 生图同步进相册（source='ai'）
    // 不带 review — AI 不点评自己生成的图
    await DB.saveGalleryImage({
        id: `ai_${char.id}_${Date.now()}`,
        charId: char.id,
        url: imageUrl,
        timestamp: Date.now(),
        source: 'ai',
    });

    setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
    imageGenerated = true;
}
```

id 用 `ai_<charId>_<timestamp>` 跟用户图（`saveGalleryImage` 由 Chat.tsx:1282 触发，id 是 Chat.tsx 那边生成）区分。不会撞。

**不写 `review` / `reviewTimestamp` / `chatContext` / `savedDate`**：
- review / reviewTimestamp：AI 不点评自己生成的图（"让 TA 点评照片"按钮对 AI 图没意义）
- chatContext：AI 生图时是"AI 主动生成的"不是"用户发的"，没有"拍照时的对话"语境
- savedDate：留给后端默认值 / 不写就好（`GalleryImage` 类型允许 undefined）

## 验证方式

1. 切到角色（江澈）聊天，让 AI 生图
2. 打开相册 App → 江澈 → 角标从 536 变成 537（多了一张 AI 图）
3. 网格里能看到 AI 刚生成的图
4. （暂时还不能 tab 区分——UI 下一轮做，但数据已经分开）

## 后续要做（不在本轮）

- `apps/Gallery.tsx`：进 grid 视图后加 tab `[用户发的图] [AI 生的图]` + 顶栏右侧两个角标 chip `(用户: <用户名>) N` `(角色: <角色名>) N` + 大图详情页加下载按钮 + 多选工具栏加取消选择/下载
- `apps/DiscoverPage.tsx`：加相册入口 + 卡片左右留白
- `context/OSContext.tsx`：加 `appStack` 让"发现页打开→返回发现页 / 桌面打开→返回桌面"两种行为并存
