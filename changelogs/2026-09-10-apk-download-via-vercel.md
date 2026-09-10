# 2026-09-10 手机端下载 APK（不用开电脑）

## 暮色 9-10 22:54 需求

暮色在手机端，电脑是 Mac 但他不想开电脑。问怎么下载电脑上的 APK 到手机。

## 方案：Vercel 静态资源托管 APK

Vercel preview 分支部署的是 SullyOS 网站（`https://sully-muse-vert.vercel.app`），本来 `public/` 目录下的所有文件 vite build 后会复制到 `dist/` 根目录，理论上 Vercel 能直接 serve。

但 `vercel.json` 的 rewrites 把所有非 `/api/` 路径都重写到 `/index.html`（SullyOS SPA fallback），所以 `.apk` 路径也会被 rewrite，暮色打开 URL 看到的是 SullyOS 网站而不是下载 APK。

## 修法

### 1. `vercel.json` rewrites 排除 `.apk`

```json
"source": "/((?!api/|.*\\.apk$).*)"
```

加上 `.*\\.apk$` 排除：URL 以 `.apk` 结尾的请求**不走 SPA fallback**，Vercel 直接返回 dist/sullyos-debug.apk 文件。

只动 `.apk`，不动其他后缀——SullyOS 网站本身的静态资源（`/assets/index-xxx.png` 等）路径不带 .apk 后缀，仍然正常 rewrite 到 index.html，网站行为不变。

### 2. `public/sullyos-debug.apk`

APK 复制到 `public/` 目录 → vite build 后自动到 `dist/sullyos-debug.apk` → Vercel 部署后 URL：

```
https://sully-muse-vert.vercel.app/sullyos-debug.apk
```

暮色手机 Chrome 打开 URL → Vercel 返回 `Content-Type: application/vnd.android.package-archive` + `Content-Disposition: attachment` → 浏览器直接下载 → 安装。

## 限制

- Vercel 单文件 100MB（APK 19.9MB 远低于）
- Vercel bandwidth：免费层够用
- 不用每次打 APK 都改 vercel.json——`.apk` 排除规则是固定的，每次 build 都会复制 public/sullyos-debug.apk 到 dist/

## 没动

- SullyOS 网站本身 SPA 行为（不带 .apk 后缀的路径仍然 rewrite 到 index.html）
- `public/loading-default.png`、`public/icons/` 等其他资源

