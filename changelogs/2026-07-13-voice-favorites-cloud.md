# 语音收藏：批量删除 + 云端持久化升级

**日期**：2026-07-13
**涉及 commit**：`d98364b` `b31110b`

## 改了什么

### 1. 批量删除（commit `d98364b`）

`apps/FavoritesPage.tsx`：
- 右上角加"多选"按钮 → 进 selection 模式
- selection 模式下 header 显示「已选 N + 删除 + 取消」
- 卡片左侧加多选圈（选中变琥珀色 + 卡片描边）
- 语音 tab 有失效条目时显示「清理 N 条已失效收藏」快捷按钮（一键全删）
- 切 tab 自动退出 selection 模式

### 2. 语音收藏上 Netlify Blobs（commit `b31110b`）

**问题**：之前只存 IndexedDB，跟着浏览器走——清缓存/换设备/换浏览器就没了。老数据（blob URL）连 IndexedDB 都没有。

**解决**：把音频文件存到 Netlify Blobs，跨设备/换浏览器/清缓存都不丢。

**新文件**：
- `netlify/functions/voice-favorite-store.ts` — RESTful API（GET / PUT / DELETE / OPTIONS）
  - key 加 `voice_fav_` 前缀防跨 namespace 冲突
  - 5MB 单文件上限（暮色日常语音 1-3MB 够）
  - 简单 key 校验（只允许字母数字，避免 `..` / `/` 越界）

**改文件**：
- `netlify.toml` — 加 `/api/v1/voice-favorite-store` redirect
- `utils/favoritesStorage.ts` — 加 `getFavoriteVoiceCloudUrl` / `uploadVoiceFavorite` / `deleteVoiceFavoriteCloud`
- `apps/Chat.tsx` — 收藏时 addFavorite + fire-and-forget 上传到云端 → 拿到 URL → updateFavorite 写回
- `apps/FavoritesPage.tsx` — 卡片 mount 时优先级：云端 URL（HEAD 探活）> IndexedDB > invalid；删除时同步清云端

## 动了哪些文件
- `apps/FavoritesPage.tsx` — 批量删除 + 云端 URL 读取 + 删除清云端
- `apps/Chat.tsx` — 收藏时上传云端
- `utils/favoritesStorage.ts` — 云端 API
- `netlify/functions/voice-favorite-store.ts` — 新增后端
- `netlify.toml` — 加 redirect

## 踩坑 / 需要知道的

### 1. 老数据不主动迁移
IndexedDB 里的老语音**不会自动上传到云端**。理由：
- 写一次性迁移脚本时机难定（什么时候跑？用户首次访问？后台？）
- 加 lazy 迁移（访问 favorites 时上传）浪费流量，且代码复杂
- 老数据继续作为本地兜底：能用，但不跨设备
- 用户访问 favorites 时云端优先，老 IndexedDB 数据还能用一阵

**取舍**：暮色接受这个方案。如果后续要全迁，再写脚本。

### 2. Netlify Functions 部署时机
- Vercel 监听 `preview` 分支自动部署前端
- Netlify Functions 是不是监听 `preview` / 监听所有分支 —— 项目没明确文档，需要暮色在 Netlify dashboard 确认
- 如果 Netlify 只监听 `master`，那本次 push 的新 function 不会自动生效，需要手动在 Netlify 触发部署，或 merge 到 master

### 3. blob URL 跨页面失效的判断
老数据里 `item.url` 是 `blob:` 开头的 URL（升级前的收藏存的），跨页面就失效。新代码要先排除 blob URL 再 HEAD 探活，避免无效请求。

### 4. KEY_PREFIX 防止越界
`voice_fav_` 前缀 + 只允许字母数字校验，防止恶意 key 跨 namespace 读 / 写其他 store 的数据。

### 5. CORS 简单粗暴
`Access-Control-Allow-Origin: *` 配合 Netlify redirect / 前端同源调用。同源调用其实不需要 CORS 头，但加上避免 Netlify function 直连（`/.netlify/functions/...`）时的 CORS 报错。

## 备注
- 收藏失败兜底链路：上传失败 → url 字段空 → 播放时回退 IndexedDB（老数据）→ 还失败 mark invalid
- 5MB 限制是临时定的，后续如果用户生成更长的语音需要调大
- 单用户单设备场景下没鉴权（项目其他 function 也不鉴权，SullyOS 是单机本地+自部署）
- 想完全清掉失效老收藏：在收藏页语音 tab 点「清理 N 条已失效收藏」
