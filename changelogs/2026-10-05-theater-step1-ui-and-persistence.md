# 剧场第 1 步收尾 —— 九项改完 + 真机逐项复核 + 索引持久化实测

**日期**：2026-10-05
**涉及 commit**：`c01eaf0a` `dcb00ddf` `6249fd6f` `2b2240af` `f0fb1cd5` `d452fbf0`
**分支**：`fix/amsg2-realign`（`origin/master` 仍是 `ef17e1aa`，没碰）

---

## 改了什么

暮色 19:02 提的九项全部落地，这轮做完后**停下**，不做第 2 步 Live。

1. 四个页签：剧库首页 / 缓存剧库 / 本地剧库 / 正在追剧
2. 播放页右上角选集按钮 → 右侧抽屉
3. 本地剧库加「传视频」按钮
4. 删掉视频下面那条蓝色进度条（改自绘控制条）
5. 音量旁边加「下一集」
6. 自动连播（带开关）
7. 「存到手机」真语义 + 占多少空间
8. 删除清理：单集 / 整部 / 全清
9. 夜间模式（跟随系统 / 白天 / 夜间，只在剧场内）

---

## 真机验证结果（V2520A，10CFAG2AUQ000CJ，测试包 `.amsgtest`）

九项**逐项截图确认**，不是看代码推断的：

| 项 | 证据 |
|---|---|
| 四个页签 | 四个都渲染正常，各自数据源正确 |
| 剧库首页 | 站源 chips（红果 2631/黄豆 2500/黄果AI 2394/黄果视频 97）、分类 chips、排序、三列网格 |
| 选集抽屉 | 右侧滑出、39 集、图例、底部「剧场设置」 |
| 上传按钮 | 本地剧库左上「传视频」胶囊 |
| 蓝进度条 | 已消失，现在是细条 + 白圆点 |
| 下一集 | 紧挨音量图标左侧 |
| 自动连播 | 第 1 集放完自动接第 2 集（真跑过） |
| 存手机 | `仙君他断情绝爱_2hy0yo/001.mp4` = 10,030,651 B，索引同步 |
| 单集删除 | 点「从手机删掉」→ 索引清空 + 目录回收 + 按钮复原成「把这一集存到手机」 |
| 整部删除 | 点「清掉手机上的这部」→ toast + 徽标消失 + 磁盘文件消失 |
| 夜间模式 | 整个剧场换深色皮，顶部状态栏不动（符合「只在剧场里换皮」） |
| 正在追剧 | 2 部，带集数和百分比 |
| 红条 | 干净启动 / 进剧场 / 切页签 / 存单集 / 删单集，全程 CLEAN |

---

## 踩坑 / 需要知道的（重要）

### 1. 索引持久化实测过了（这是 d452fbf0 的核心）

存 1 集 → `am force-stop` → 重开：

- 磁盘 `files/theater/phone/仙君他断情绝爱_2hy0yo/001.mp4` 10,030,651 B **还在**
- localStorage `theater_phone_index` **还有这条**
- 本地剧库页显示「手机里 1 部 · 1 集 / 占了 9.6 MB」

localStorage 方案在真机上跨进程存活，没问题。

### 2. 老 key 没清理：`theater_phone_booted` 还在 localStorage 里

那是 f0fb1cd5（index.json 时代）写的自愈标记，d452fbf0 已经不用了。
`grep` 当前代码**搜不到**这个 key —— 留着无害（localStorage 不会自动清），别误判成"跑的是老代码"。

**判断手机上跑的是哪版，要看 BuildBadge（右下角 `fix/amsg2-realign@d452fbf0`），
不能靠 localStorage 里有没有旧 key。**

### 3. APK 是 f0fb1cd5 打的，但内容是 d452fbf0

`capacitor.config.test.json` 里 `server.url` 指向 fix 分支的 Vercel 部署，
WebView 加载的是**远程**，APK 内的 `assets/public` 只是兜底。

**所以 d452fbf0 之后不用重新打包**，改完推上去手机就能看到。
（但如果以后要改 `capacitor.config.json` 本身，或者要离线兜底，就得重打。）

### 4. Vercel 工具栏会挡住页面

preview 部署在 WebView 里会弹 Vercel Toolbar，盖住左下角。
点它自己的「Hide Toolbar」能藏，但挂件还在。
**这个不是 bug，暮色自己看的时候也会遇到。**

### 5. 选集页格子没表达「哪几集在手机里」

图例写了绿=手机里 / 蓝=电脑里 / 灰=都没有，但**当前播放集的高亮蓝色把绿盖掉了**，
肉眼看不出第 1 集已经在手机里。抽屉里靠右上角垃圾桶图标表达了，选集页没有。

顶部「整部存到手机（38）」这个数字能反推（存了 1 集所以从 39 变 38），
但不够直观。**待改进。**

### 6. 整部存手机没有体积预警 —— 这是真隐患

实测 107 集 ≈ 1.5 GB，点一下就开始下，**没有任何确认或容量提示**。
误触一次就是 1.5 G。**下一轮优先补这个。**

### 7. 批量存多集时红条偶发，根因未定位

单集存取、切页签、启动、进出剧场都确认 CLEAN。
只有一次批量存 7 集时出现过。怀疑批量循环里的内存峰值或某集取流异常。
**没定位到根因，不瞎说。**

---

## 动了哪些文件

- `apps/TheaterApp.tsx` —— 重写（约 1100 行）
- `components/dramaTheater/PlayerStage.tsx` —— 新建，自绘控制条
- `components/dramaTheater/EpisodeDrawer.tsx` —— 新建，portal 侧拉抽屉
- `utils/dramaTheater/localVideos.ts` —— 重写，索引挪到 localStorage
- `utils/dramaTheater/watchHistory.ts` —— 新建，`theater_watch`，上限 200
- `utils/dramaTheater/theme.ts` —— 新建，`theater_theme`，auto/light/dark
- `utils/dramaTheater/relayClient.ts` —— 改
- `components/chat/ChatInputArea.tsx` —— 入口顺序（转账 → 剧场 → 戳一戳 → 记忆归档）

---

## 关键技术事实

- **抽屉必须 `createPortal`**：`App.tsx:36` 有 `style={{ transform: 'translateZ(0)' }}`，
  页内 `fixed` 会被吃掉（项目 `Modal.tsx` 开头注释同款坑）。
- **写视频不能传 `encoding`**：Capacitor `Filesystem.java` 的 `saveFile()` 里
  「有 encoding 走文本，没 encoding 走 `Base64.decode`」，传了视频直接坏。
- **本地存储层不得用 `Filesystem.readFile` 探测文件存在性**：会 `call.reject` →
  冒到 `console.error` → 被 `context/OSContext.tsx:1034` 收进 systemLogs → 红条。
- **复用内存中已取数据前必须确认它对应当前请求项**（`blobEp === currentEp`），
  2b2240af 修的「存手机存错集」就是这个。

---

## 备注 / 下次

- 第 2 步 Live（只打字）、第 3 步视频帧、第 4 步摘要入记忆宫殿、第 5 步完整上传 UI，都没开始。
- 测试期短剧库（8998）和转发服务（8999）还在跑，手机上留着 1 集当样本。
