# 相册下载按钮 + 发现页留白

## 背景

第 4 块：详情页 + 多选工具栏加下载按钮。
第 5 块：发现页入口列表左右留白（`px-3` → `px-5`）。

## 改动文件

### 1. `apps/Gallery.tsx` — 下载功能

**新 state**（L22）：
```ts
const [isBatchDownloading, setIsBatchDownloading] = useState(false);
```

**新 3 个 handler**（handleBatchDelete 后面）：

```ts
const downloadImage = async (img: GalleryImage) => {
    try {
        const res = await fetch(img.url);
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `sully_<charId>_<savedDate或timestamp>.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e: any) {
        addToast(`下载失败: ${e.message}`, 'error');
        throw e;
    }
};

const handleDownload = (img: GalleryImage) => {
    downloadImage(img).catch(() => {});
};

const handleBatchDownload = async () => {
    const targets = images.filter(img => selectedIds.has(img.id));
    if (targets.length === 0) return;
    setIsBatchDownloading(true);
    let ok = 0, fail = 0;
    for (const img of targets) {            // 串行触发
        try { await downloadImage(img); ok++; }
        catch { fail++; }
    }
    setIsBatchDownloading(false);
    if (fail === 0) addToast(`已下载 ${ok} 张`, 'success');
    else addToast(`下载完成 ${ok} 张，${fail} 张失败`, 'warning');
};
```

**详情页 header 改**（L409-425）—— 左侧返回不变，右侧 2 个按钮：

```tsx
<div className="flex gap-2 pointer-events-auto">
    <button onClick={() => selectedImage && handleDownload(selectedImage)}
        className="...px-3 py-2 rounded-full text-[11px] font-medium flex items-center gap-1.5...">
        <svg>↓</svg>下载
    </button>
    <button onClick={handleDeleteImage} className="...p-2 rounded-full...">
        <svg>🗑</svg>
    </button>
</div>
```

下载按钮：`bg-black/40 backdrop-blur-md` + 圆角胶囊 + 图标 + "下载" 文字。

**多选工具栏改**（L384-417）—— 4 个按钮：

```tsx
<div className="...flex items-center justify-center gap-2 z-10">   {/* gap-3 改 gap-2 */}
    <button onClick={handleExitSelection} className="...text-slate-500...">取消选择</button>
    <button onClick={handleSelectAll} className="...bg-slate-100...">全选/取消全选</button>
    <button onClick={handleBatchDownload} disabled={...} className="...bg-sky-100 text-sky-600...">下载 N 张</button>
    <button onClick={handleBatchDelete} disabled={...} className="...bg-rose-400...">删除 N 张</button>
</div>
```

按钮配色：
- 取消选择：浅灰文字（无背景）
- 全选：`bg-slate-100` 灰
- 下载：`bg-sky-100 text-sky-600` 蓝（跟删除的红色区分）
- 删除：`bg-rose-400 text-white` 红（危险动作，保留原色）

### 2. `apps/DiscoverPage.tsx:87` — 入口列表留白

```tsx
{/* 原 */}
<div className="flex-1 overflow-y-auto px-3 pt-3">

{/* 改 */}
<div className="flex-1 overflow-y-auto px-5 pt-3">
```

`px-3`（左右各 12px）→ `px-5`（左右各 20px）。单字符改动。卡片本身结构不动。

## 已知风险（不修复，按暮色 8-21 接受）

- **跨域图床**：`fetch(img.url)` 会被 CORS 拒——自己存的 dataURL 没事，外部图床看服务器
- **iOS Safari**：`a.download` 不生效（iOS 直接打开图片）— fallback 是"长按图片另存为"
- **Chrome 多文件下载提示**：批量下载 16+ 张会弹"是否允许多文件下载"——浏览器原生行为

## 验证方式

1. 详情页右上：返回 · 下载 · 删除
2. 多选模式底栏：取消选择 · 全选 · 下载 N · 删除 N
3. 下载按钮点击后浏览器开始下载文件，文件名 `sully_<角色id>_<日期>.png`
4. 发现页入口列表左右各 20px 留白

## 不在本轮做的

- 第 6 块：OSContext appStack
- 第 7 块：WeChat 启动模式
- 第 5 块的发现页"加相册入口"：留白做了，入口没加——等第 6 块 appStack 一起做（不然加了入口但跳过去返回不了发现页）

## changelog 注

第 5 块这次只做了"卡片留白"。"加相册入口"延后到第 6 块 appStack 一起做——否则入口跳过去返回到桌面，违反暮色 8-21 "发现页打开→返回发现页"的要求。
