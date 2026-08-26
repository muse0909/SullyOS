# 8-26 4 个问题修复 — Portal 覆盖 + RP 角色指令 + 文风预设 + 全局默认

暮色 8-26 一次给 4 个反馈(按顺序)修,1 个 commit + changelog 一起发,build 验证通过。

预览:`sully-muse-vert.vercel.app`(preview HEAD `67ff6ee7`,领先 master 10 个)

## 问题 1·配置剧场页面层叠/裁切(UI 修复,最高优先级)

**症状** — 进入中间页,列表页("剧情剧院"标题 + SCENES + 齿轮 + 模板卡)露在背后,中间页自身顶部内容被裁切只剩一半。

**根因** — 之前 commit `670df3a8` 把 `absolute` 改 `fixed`,理论分析是"脱离父容器 stacking",但实际没生效。深挖 PhoneShell:

- 背景层(`PhoneShell.tsx:451`):`transform: scale(1.1)` 当 `activeApp !== Launcher` 时
- App 容器(`PhoneShell.tsx:471`):`contain: layout style paint`

CSS 规范里,`transform` / `filter` / `perspective` / `contain: layout/paint` 都会**创建 fixed 定位的 containing block** — 也就是 fixed 不再相对 viewport,而是相对那个祖先。所以 SceneConfigPage 的 `fixed inset-0 z-50` 实际困在 PhoneShell 内部那个 div 里。

同时顶栏 `paddingTop: 'max(1.25rem, var(--safe-top))'` — `--safe-top` 在 `:root` 定义,值是 `env(safe-area-inset-top)`。但 PhoneShell 外层 App 容器(`PhoneShell.tsx:477`)已经有 `top: calc(env(safe-area-inset-top) + 2.5rem)` 的偏移。所以 SceneConfigPage 顶栏的安全区 padding 跟外层叠加,顶栏内容被推到容器顶部安全区以下再往下 1.25rem → 顶部被裁。

**修法** — SceneConfigPage + RPApiSettingsPage 改用 `createPortal(..., document.body)`,挂到 body 逃出所有 stacking/transform/contain 影响。portal 出去后 fixed 真正相对 viewport,顶/底 paddingTop 改用 `env(safe-area-inset-top/bottom)` 直接读 viewport(不再用 `var(--safe-top)` 双重叠加)。

**改了什么**:
- `components/date/story/SceneConfigPage.tsx` — import `createPortal`,整个 return 包 `createPortal(<div ...>, document.body)`,顶栏 paddingTop 改 `calc(env(safe-area-inset-top) + 0.5rem)`,底部 paddingBottom 改 `calc(env(safe-area-inset-bottom) + 1rem)`
- `components/date/story/RPApiSettingsPage.tsx` — 同样改 Portal(API 设置页有同款问题,顺便修)

**验证** — 暮色刷新看预览版:
- 中间页应该完全覆盖全屏,不露列表页
- 顶栏"配置剧场"标题完整可见,从安全区顶部开始
- API 设置页同理

---

## 问题 2·RP 提示词加 UI 入口

**暮色原话** — "RP 提示词完整内容我会另外提供。先加 UI 入口,内容存到 Entry 上,buildRPSystemPrompt 注入到预留位置。"

**改了什么**:
- `types.ts` — `StoryTheaterEntry` 加 `rpInstructions?: string`
- `utils/storyTheater.ts` — `createEntryFromSceneTemplate` args 加 `rpInstructions?: string`,写入 entry
- `utils/storyTheater/prompts.ts` — `buildRPSystemPrompt` 把之前的 `__RP_INJECTION_POINT__` 占位符替换成 `### 角色指令(...)` 段(如果 entry.rpInstructions 存在,否则不注入)
- `components/date/story/SceneConfigPage.tsx` — 在"文风"section 上方加"角色指令(RP System Prompt)"多行文本框,placeholder:"在这里写角色在RP模式下的总体行为指令(如:可以主动推剧情、描写带五感、不要出戏等)"
- `components/date/story/EntryEditModal.tsx` — session 内编辑弹窗同样加该文本框

**暮色后续** — 等暮色给完整 RP 提示词内容,直接粘贴进去即可,代码不用改。

---

## 问题 3·文风预设 7 选

**暮色原话** — "7 个选项:默认质感 / 汽水日常 / 潮雨走廊 / 荒诞喜剧 / 直球甜宠 / 钝刀虐心 / 冷峻正剧。每个选项对应一段预设文风描述文本。点选自动填入文风输入框(用户可在此基础上再改);再点一次取消选择,输入框清空。也可以不选任何预设直接手写。"

**改了什么**:
- 新建 `components/date/story/writingStylePresets.ts` — 7 个文风预设,描述文本参考原版 `night-screening-v6.14.sully.json` 里的 7 个 style 段 content(去掉暮色没要的"黑喜剧")
  - 默认质感 — 空 prompt(不注入文风指令)
  - 汽水日常 — 清亮自然,小决定改变两人距离
  - 潮雨走廊 — 画面保留遮挡旧痕,危险从细节里露出来
  - 荒诞喜剧 — 轻小说喜剧,人物过度认真+错误重点
  - 直球甜宠 — 甜不是情节是投递方式
  - 钝刀虐心 — 虐不是事件是凌迟的节奏
  - 冷峻正剧 — 权谋利益,信息即武器
- `SceneConfigPage.tsx` / `EntryEditModal.tsx` / `RPApiSettingsPage.tsx`(全局默认区)— 三处都加 7 个文风预设卡片(3 列 grid),点选填入,再点取消,跟叙事参数卡片样式一致

---

## 问题 4·全局默认配置(剧情剧院齿轮)

**暮色原话** — "齿轮里 API 设置下方加'默认配置'区,包含:文风预设默认值 + 4 叙事参数默认值 + RP 总指令默认内容 + 解锁提示词默认内容 + 生成参数 5 字段默认值。存到新全局配置(新开 store 或挂 globalConfig 都行)。新建剧场时自动继承这套默认配置,用户也可在单独剧场的中间页/session 弹窗里覆盖。做好隔离 — 单独剧场改自己不影响全局默认,全局默认改了不影响已建剧场(只影响之后新建)。"

**改了什么**:
- `types.ts` — 新建 `RPGlobalDefaults` 接口(singleton 记录,id 永远 `'singleton'`)
- `utils/db.ts` — DB_VERSION `68 → 69`,加 `STORE_RP_GLOBAL_DEFAULTS` + `getRPGlobalDefaults` / `saveRPGlobalDefaults`
- `components/date/story/RPApiSettingsPage.tsx` — 大改造:标题改"RP 设置",在 API 配置 section 下方加"默认配置"section,内容包含 RP 总指令 / 7 文风预设 / 4 叙事参数(单选,带"不设默认"清空按钮)/ 解锁提示词 / 生成参数 5 字段(温度/最大长度/topP/频率惩罚/话题惩罚),底部"保存默认配置"按钮
- `components/date/story/SceneConfigPage.tsx` — 加载全局默认并注入初始值(useEffect 里调 `DB.getRPGlobalDefaults`,把所有 default 字段 set 进去)

**隔离验证**:
- 改全局默认 → 只影响之后新建的剧场(SceneConfigPage 进入时才注入)
- 单独剧场改自己的 → 只改自己 entry(在中间页或 session 弹窗改 → 写回该 entry,不影响全局默认)
- 已建好的 Entry → 不被回写(改全局默认不触发老 entry 更新)

---

## 涉及的 8 个文件

```
M components/date/story/EntryEditModal.tsx        (54 行新增:rpInstructions state + 文风预设)
M components/date/story/RPApiSettingsPage.tsx     (560 行新增:Portal 修 + 默认配置 section)
M components/date/story/SceneConfigPage.tsx       (109 行新增:Portal 修 + rpInstructions + 文风预设 + 全局默认注入)
A components/date/story/writingStylePresets.ts    (新文件:7 个文风预设)
M types.ts                                         (31 行新增:rpInstructions 字段 + RPGlobalDefaults 接口)
M utils/db.ts                                      (32 行新增:DB v69 + STORE + get/save 方法)
M utils/storyTheater.ts                            (3 行:createEntryFromSceneTemplate 加 rpInstructions 参数)
M utils/storyTheater/prompts.ts                    (4 行:替换 __RP_INJECTION_POINT__ 为条件注入)
```

## 跟之前 8-25 第二批/第六批/第七批的关系

- 跟 8-25 第五步(中间页)扩展 — 同一个组件,加 3 个新 section
- 跟 8-25 第七批(叙事参数 4 卡片)样式一致 — 4 选项卡片直接复用
- 跟 8-25 第二批(Author's Note / 状态栏 / Jailbreak / 4 字段)扩展 — RP 总指令是同一类"用户填的额外指令"字段,buildRPSystemPrompt 注入位置在最后(替换原占位符)
- 跟 8-25 第六步第一批(API 设置)整合 — 同一页加 section,不另开页

## 暮色后续

- 改完后刷 Vercel 预览,问题 1 重点验证(中间页/默认配置 section)
- RP 总指令内容,暮色发给我直接填(可填默认配置区,所有新建剧场继承;也可在单独剧场里覆盖)
- 全局默认配置的"不设默认"按钮(4 叙事参数)有清空作用,但目前只清 narrativePerson / authorityLevel 等 4 个,RP 总指令和文风预设是手动清空输入框/点"默认质感"卡片
