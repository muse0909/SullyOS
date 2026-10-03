# 主动消息 2.0 面板文案第三轮 + 设置页折叠版本信息（暮色拍板的六条）

**日期**：2026-10-03
**涉及 commit**：`a4d6304a`（UI 改造，本次）、`97baae55`（测试包绑 fix 分支，上一次）

---

## 改了什么

暮色 2026-10-03 看着实物提的六条，不是推演出来的：

1. **删掉第四个「角色自设」选项**。那是 2026-09-18 加的 `disabled: true` 占位项，
   永远点不亮，只为让用户知道"角色也能排任务"这件事——占掉四分之一的格子，信息
   价值抵不上占位。信息没丢两处：「新建任务」按钮下面新加一行"角色和用户均可排
   主动消息任务"；任务列表里角色排的那些照样标「角色自设」。

2. **策略标签换词**。暮色否掉了我上一轮提的「到点不说话」，原话：
   > 「到点不说话」我不喜欢，读起来像是你不说话，有歧义。

   换成他自己想的一对：**「你在忙就算了」/「你在忙就晚点提」**。从用户视角说，
   不出现"作废""策略"这类内部词，也不用解释 expire / force 是什么。
   底层标识符 `expire` / `force` 一个字没动。

3. **两条描述重写**。上一轮的「顺口带出，30 分钟后还没带就补一句」漏了两件关键事：
   - 兜底那条**用户会真的收到**，不是内部悄悄补；
   - 兜底发的是「到点啦：你当初定的那件事」，**不是模型生成的原话**
     （`buildFallbackText`：fixed 模式发你写的原文，其他模式发「到点啦：…」），
     兜底根本不调模型。所以「照原话」那个说法也是错的，一并改掉。

4. **策略选择器标题**「到点时用户正在聊天」→「**到点前 10 分钟你说过话**」。
   判据其实是后者：租约只覆盖 AI 生成中那几秒，用户在聊天页纯阅读超 45 秒，
   云端就判不在场了。照旧标题理解会以为"我只要开着页面就永远不插话"。

5. **描述字号** `text-xs` → `text-[10px]`，按钮补 `px-3` + `py-3`，描述间距
   `mt-0.5` → `mt-1.5`，加 `leading-relaxed`。暮色截图里"强制发送"那句挤成两行
   顶在边框上，要留空。

6. **设置页底部加折叠版本信息块**（暮色原话「这条比改文案重要」），显示
   分支+提交号 / 加载网址 / 构建时间 / 应用版本。

### 顺带修的

- 面板那条提示用户的话 `已给 N 条「强制发送」任务补上 30 分钟后的兜底` 还写死旧名，
  改成走 `describeExpirePolicy('force')`——策略名不再有第二份手写副本。
- `amsg2BothDirections.test.ts` 的时间锚点从写死的 `2026-10-01T08:00:00Z`
  改成**今天本地 08:00**。
- `amsg2Tasks.test.ts` 三条字面量断言跟着新措辞改（盯的规矩没松，见下）。

---

## 动了哪些文件

- `components/chat/ActiveMsg2SettingsModal.tsx` —— 删选项、三条模式介绍重写、
  按钮下那行说明、策略标题、按钮/描述排版、兜底提示改走 describeExpirePolicy、
  底部折叠版本信息块
- `utils/amsg2Tasks.ts` —— `describeExpirePolicy` 换词 + `EXPIRE_POLICY_OPTIONS`
  标签/描述重写（含为什么换、为什么描述要重写的大段注释）
- `utils/buildInfo.ts` —— 新增 `LOADED_HOST`（读 `window.location.host`）
- `utils/amsg2Tasks.test.ts` —— 3 条字面量断言
- `utils/amsg2BothDirections.test.ts` —— 时间锚点改成相对

---

## 踩坑 / 需要知道的（重要）

### 1. **改 UI 不用重打包，重打包也不会让 UI 生效** ⚠️

APK 里那份 `assets/` 的网页副本**根本不参与运行**——`capacitor.config.json` 的
`server.url` 一旦有值，Capacitor 就从远程加载网页。所以：

- 改了 UI → 提交推 fix 分支 → Vercel 部署完 → **手机上刷新就是新的**；
- 反过来，重打 APK 对 UI 一点用没有，只有 `server.url` 变了才需要重打。

今天这次重打 APK 是为了版本号钢印对得上 `a4d6304a`，不是为了 UI。

### 2. **`LOADED_HOST` 为什么必须跟 `BUILD_LABEL` 一起看**

今天查"跑的到底是哪个分支的代码"花了五条独立证据（APK 内 config / git 历史 /
截图旧文案 / 远端 bundle 符号 / CDP 读 url）。根因就是 `server.url` 指错。
`BUILD_LABEL` 说「**这份网页代码**从哪个分支构建」，`LOADED_HOST` 说「**手机现在
在连哪个域名**」——两个对不上，就是域名指错了。

顺带一提：右下角那个构建钢印（`fix/amsg2-realign@a4d6304`）**本来就有**，但它只
有分支和提交号，**没有域名**——今天缺的就是这一块。所以新块不是重复造轮子，是把
钢印缺的那一维补上。

### 3. **Vercel 会把整段提交说明内联进主包**（查实了，三个部署都有）

线上主包里能搜到本次提交的说明全文。机制不是我们写的代码，是 Vite 把
`import.meta.env` 整个内联，而 Vercel 把系统环境变量 `VERCEL_GIT_COMMIT_MESSAGE`
暴露成了 `VITE_VERCEL_GIT_COMMIT_MESSAGE`，于是它跟着进了包。位置在主包开头
约 8.7k 字符处，宿主就是那个 env 对象字面量。

实测三个部署都这样：

| 部署 | 嵌进去的是 |
|---|---|
| master | `ef17e1aa` 的提交说明 |
| preview | `ef17e1aa` 的提交说明 |
| fix | `a4d6304a` 的提交说明 |

**不是本轮引入的，也不影响功能**（注释类文本不渲染）。但要知道两件事：
一是别再像麦麦今天那样把它当成"异常"；二是**提交说明里别写密钥**——现在任何
能打开网页的人 `curl` 一下主包就能读到。要根治就在 `vite.config.ts` 里显式
`envPrefix` 白名单（把 `VITE_VERCEL_*` 排除掉）。

### 4. 我自己今天犯的两个错，记下来别再犯

- **字节数 vs 字符数**：先 `ls -la` 看的是字节（5,374,284），后用 Python
  `len(str)` 看的是字符（5,082,184）。中文一个字 3 字节，混着比就得出
  "线上比本地大 294 KB" 的假结论——其实只差 3 KB，就是本次新增的注释。
- **CDP 里拼相对路径**：`new URL('assets/' + chunk, mainUrl)`，而 `mainUrl` 本身
  已经在 `/assets/` 下，结果拼成 `/assets/assets/...`，404，还以为"新文案没打进去"。
  正确写法 `new URL(chunkName, mainUrl)`。

### 5. **测试时间锚点为什么会自己变红**

`amsg2BothDirections.test.ts` 原来写死 `2026-10-01T08:00:00Z`，而任务
`recurrenceType='daily'`、`pruneStaleTasks` 的规则是"过点 48h 出清单"。锚点一过
2026-10-03 16:00，两条用例自动变红。今天下午撞上了，用 `git stash` 回到改动之前
跑**同样红**，排除了是新引入的。

这类失败比没有测试更糟——它是"日历走到那一天就自己亮红灯"，会把真回归淹掉。
现在锚在"今天本地 08:00"，任何时刻跑都在 48h 回看窗内（最坏 8 小时前、最好 16
小时前）。**测试内部的时间相对关系一个字没改**（回执仍是 occurrenceMs + 5s、
任务仍是 T - 1h、消费仍是 T + 10min），改的只是绝对锚点。

### 6. 三条断言改了，但规矩没松

盯的还是原来那三件事，只是换新措辞：

- expire 必须说清"这次不说了 / 聊天里不会出现"，且**不许出现"带出"**；
- force 必须说清"顺口提一句"**外加 30 分钟兜底**；
- 到点那份清单必须带策略名——改成断言 `describeExpirePolicy('force')`，
  不是改成"只要有字就行"那种糊弄版。

### 7. vivo 装包会被系统层拦

三次全挂在 `INSTALL_FAILED_ABORTED: User rejected permissions`：
`adb install -r`、`adb install -r -g`、`adb push + pm install -r -g`。
`settings put global verifier_verify_adb_installs 0` 没用。**必须手机上手动开
开发者选项的「USB 安装」**，开了之后一次就成。

---

## 核对方式（我自己核的，结论在下面）

- `npx tsc --noEmit` → **379 个错**，与基线一致，改动文件没引入新错
- `npx vitest run` → **452 通过 / 5 失败**，回到历史基线（那 5 条是
  `amsgFirePack` 1 条 + `vrWorld` 3 条 + `describeRemoteLastError` 1 条，都与本轮无关）
- `npm run build` → 通过
- 包身份：`package: com.aetheros.simulator.amsgtest`、
  `versionName: 2026-10-03-a4d6304a-test`、`label: Sully`
- 包内 `assets/capacitor.config.json` 的 `server.url` =
  `https://sully-os-git-fix-amsg2-realign-muse0909s-projects.vercel.app`
- 装完启动后，在 app 内（CDP）实测：
  - `location.host` = `sully-os-git-fix-amsg2-realign-muse0909s-projects.vercel.app`
  - 主包里 `a4d6304` 命中、`97baae5` 0 命中
  - `你在忙就算了` / `你在忙就晚点提` 命中；旧的 `遇忙作废` **0 命中**
  - `到点前 10 分钟你说过话` / `角色和用户均可排主动消息任务` / `加载网址` 均命中
- 手机屏幕右下角构建钢印：`fix/amsg2-realign@a4d6304`

**数据库里能查到什么**：本轮纯前端文案，不碰云端判据。`sully-amsg2-test` 库的
`scheduled_messages` 仍是 0 条，等真机验收排了任务再逐条对。

---

## 备注

- master / preview 全程没碰，还在 `ef17e1aa`。等 11 步真机验收过了才合。
- 本轮**没动 worker**。
- `scripts/amsg-watch.sh`（监控脚本）仍未提交，用不用等暮色定。
- 新块目前只加在主动消息 2.0 面板里。如果暮色想在**系统设置最底下**也放一份
  （而不是只在 2.0 面板里），说一声，改位置很快。
