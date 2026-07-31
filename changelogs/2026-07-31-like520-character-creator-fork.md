# 彼方 / 520 捏人器修复：fork 完整 character_creator.html

**日期**：2026-07-31
**涉及 commit**：`a20fb48`

## 改了什么

暮色反馈"接入页点 toggle 跳到锁屏页，每点一次就多一个状态栏和悬浮窗"。

### 根因

`components/Like520Event.tsx:137` 写死 `CHAR_CREATOR_URL = "/like520/character_creator.html"`（相对路径）。这文件**原作者 To 佬单独维护**，**不在 SullyOS GitHub 仓库**（`qegj567-cloud/SullyOS`）里——只在 To 佬的 Vercel 主站 `sully-os-nu.vercel.app` 上跑。

暮色 fork 的时候只 sync 了 source code，**没拿到这个 HTML**。Vite build 时 `public/like520/character_creator.html` 不存在 → dist 也没有这个文件。

但 Vercel `vercel.json` rewrite 规则 `/((?!api/).*) → /index.html` 是 SPA fallback——**所有非 /api 路径找不到静态文件时都重写到 index.html**。

所以：
1. iframe 加载 `/like520/character_creator.html`
2. Vercel 找不到这个静态文件
3. 走 rewrite → 返回 `index.html`（主应用）
4. iframe 加载完整 SullyOS 主应用——默认 `isLocked=true` → 显示锁屏页（"TAP TO UNLOCK / SULLYOS SIMULATION"）
5. 每次点 toggle 打开 chibi editor → 重新挂一个 CreatorIframe 元素 → 视觉上"多一个状态栏和悬浮窗"（其实是 iframe + iframe 里的锁屏 UI）

### 这次改的

**从 To 佬 Vercel 主站 fetch 完整的 character_creator.html，存到 `public/like520/character_creator.html`**。

```bash
mkdir -p public/like520
curl -sL https://sully-os-nu.vercel.app/like520/character_creator.html \
  -o public/like520/character_creator.html
```

1.5MB 完整版（含所有 CSS/JS/贴图 base64 内嵌，自包含）。Vite build 时直接拷到 `dist/like520/character_creator.html`。Vercel **先看静态文件**——找到了直接服务，不走 rewrite。

**附加：fallback 方案**——如果 To 佬 Vercel 挂了，将来 1.0 计划改 URL 指到原作者主站绝对路径（`https://sully-os-nu.vercel.app/like520/character_creator.html`），那是 plan C。

## 动了哪些文件

- `public/like520/character_creator.html` —— 新增（1.5MB，from To 佬 Vercel）

**没动**任何 source code——bug 是在 deploy assets 缺失，不在 React 代码。

## 踩坑 / 需要知道的（重要）

- **Vercel rewrite 优先级**：先看 dist 静态文件，**找到了直接服务**；找不到才走 rewrite。Vite `public/` 目录的文件会原样拷到 dist。所以 `public/like520/character_creator.html` 部署后**不会**被 rewrite 到 index.html
- **HTML 是从 To 佬站 fetch 来的**：1.5MB 自包含，没法保证 To 佬升级后我们这个 fork 还是最新——下次 To 佬发新版，我们得手动再 fetch 一次
- **postMessage 协议稳定**：HTML 里通过 `like520_init` / `like520_ready` / `like520_result` 跟外层 React 通信；fetch 下来的 HTML 协议跟 `components/Like520Event.tsx` 里一致（同一作者维护的），不会不兼容
- **`public/like520/character_creator.html` 是 SullyOS 项目的"部署资产"**，不是 source code。暮色如果后续 sync 原作者 SullyOS 仓库代码，要小心别把这个文件当 source 看待（它不会出现在原作者的 git repo 里）

## 备注

- 暮色说"完整 fork"——我这次只 fetch 了这个 HTML 资产。To 佬的其他私仓资产（如可能的部件库）如果后面发现 404 报错，再补
- 之前 7/31 修彼方 app 的 changelog `2026-07-31-vrworld-missing-db-methods.md` 是 DB 方法缺失，跟这次"捏人器 HTML 缺失"是**两个独立 bug**，刚好同一天都爆出来
- **同类风险**：`public/` 里其他 To 佬私有资源（如 future creator parts CDN、bgm 之类）如果 iframe 引用了绝对 URL，走 To 佬的 `sully-os-nu.vercel.app`——稳定性依赖 To 佬
