# 相册：两个 chip 切 tab（用户图 / AI 图）

## 背景

8-21 上一个 commit 加了 `GalleryImage.source` 字段 + AI 生图自动写相册。本轮做 UI：进角色相册后顶栏改用两个 chip（本身就是 tab）切「用户发的图」/「AI 生的图」。

暮色确认的设计：
- 顶栏中央留空（不要"江澈 536"那种标题）
- 右上两个 chip：`用户:<用户名> N` + `AI:<角色名> N`
- chip 本身就是 tab，点哪个高亮，下面网格跟着切
- 默认切到 AI 生的图

## 改动文件

### `apps/Gallery.tsx` — 顶栏 chip + tab 切换

**新 state**（L14-16）：
```ts
const [activeTab, setActiveTab] = useState<'user' | 'ai'>('ai');  // 默认 AI
const [tabCounts, setTabCounts] = useState<{ user: number; ai: number }>({ user: 0, ai: 0 });
```

**新派生值**（handleCharClick 附近）：
```ts
const visibleImages = images.filter(img => (img.source || 'user') === activeTab);
```

**新 handler**：
```ts
const handleTabSwitch = (tab: 'user' | 'ai') => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    if (isSelectionMode) {
        setIsSelectionMode(false);
        setSelectedIds(new Set());  // 切 tab 清多选
    }
};
```

**useEffect 改并行查**（L46-63）：进入 grid 时同时拉 3 个查询（user 数 / ai 数 / 全量），存到 `tabCounts` 和 `images`。

**顶栏改**（L504-545）：删掉"江澈 536"中央标题 + `images.length` 计数。改为：
- 角色相册视图（albums）：保持"相册"标题
- grid 视图：返回 + 居中两个 chip + 右侧"选择"按钮
- 多选态：保持"取消 · 已选 N 张"

**chip 样式**：
- 未选中：`bg-slate-100 text-slate-600`（浅灰底 + 灰字）
- 选中：`bg-indigo-500 text-white shadow-md`（主色背景 + 白字 + 投影）

**renderGrid 改**（L350-413）：
- `images.map` → `visibleImages.map`（只渲染当前 tab 的图）
- 空态判断分两种：全空 (`images.length === 0`) vs tab 过滤空（`visibleImages.length === 0`）
- "全选"按钮判断用 `visibleImages.length`（不是 `images.length`）

## 用户名 / 角色名取数

- **用户名**：`useOS().userProfile.name`，默认 `'User'`（OSContext 里的 defaultUserProfile）
- **角色名**：`characters.find(c => c.id === activeCharId)?.name`

## 多选跨 tab 行为

按暮色确认：**切 tab 时清空 selectedIds + 退出多选态**。理由是"AI 图和用户图不是同种来源，跨 tab 一起选/删会混"。清空逻辑在 `handleTabSwitch` 里。

## 不在本轮做的

- 第 4 块：下载按钮（详情页 + 多选工具栏）— 下一轮
- 第 5 块：发现页加相册入口 + 卡片留白 — 下一轮
- 第 6 块：OSContext appStack — 下一轮
- 第 7 块：WeChat 启动模式 — 下一轮

## 验证方式

1. 切到江澈相册（默认 AI tab 高亮）→ 应该看到 AI 生的图（暮色已有 0~20 张）
2. 点"用户:暮色 N" chip → 切到用户图（536 张）+ 数字跟着切
3. 进多选态后切 tab → 自动退出多选
4. 老数据（source=undefined）走"用户" tab（兜底逻辑在 db.ts filter 里）
