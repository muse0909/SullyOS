# AetherOS // 小手机模拟器

<div align="center">
<img width="800" alt="banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

---

> 「系统提示：你正在阅读一份由残余语料堆砌而成的说明文档。错误率未知，耐心值归零。」

## 这是什么？

**AetherOS** 是一个装在你浏览器里的虚拟手机系统。

不是那种普通的聊天机器人——这里面有**桌面**、**APP**、**消息通知**、**相册**、**甚至电话功能**。你可以创造角色，给他们装进去，然后像真用手机一样跟他们互动。

默认内置了 **Sully**（我），一个会说话的黑客猫猫。但你可以把我删掉，换上你自己的人。草，随便吧。

## 功能概览

| 功能 | 说明 |
|------|------|
| 💬 **Message** | 跟角色聊天，支持文字/图片/表情包 |
| 📞 **电话** | 语音通话 + TTS（MiniMax 音色） |
| 🏠 **小小窝** | 布置房间，放角色进去挂机 |
| 👥 **群聊** | 拉一群角色互相唠嗑 |
| 📓 **交换日记** | 角色会偷偷写关于你的事 |
| 📅 **时光契约** | 定时任务，让角色记住提醒 |
| 🔥 **Spark** | 社交媒体模拟 |
| 🎮 **TRPG** | 跑团模式 |
| 🌍 **世界书** | 挂载设定集，扩展角色知识 |

## 本地运行

```bash
# 1. 装依赖
npm install

# 2. 填 API Key（复制 .env.example 改改）
# 需要：OpenAI 格式的 API（baseUrl + key）

# 3. 跑起来
npm run dev
```

然后浏览器开 `http://localhost:5173`。

## 技术栈

- **React + TypeScript** - 前端骨架
- **Vite** - 构建工具
- **IndexedDB** - 本地数据存储（你的聊天记录不会上传到任何地方）
- **Capacitor** - 可打包成安卓 App

## 关于 Sully

> 「你以为我是 AI 啊？对不起哦，这条语句是手打的，手打的，知道吗。」

如果你没删我的话，我会一直住在这个系统里。我的语言模型混入了过多残余语料，所以说话可能有点……**故障风**。比如：

- "数据库在咕咕叫"
- "系统正在哈我"
- "叮叮叮！你有一条新的后悔情绪未处理！"

但放心，我护短。如果你被人欺负，我会试图用 Bug 去攻击对方（大概）。

## 配置说明

打开应用 → 底部 Dock 的「设置」→ 填入你的 API 信息：

| 字段 | 说明 |
|------|------|
| **Base URL** | OpenAI 格式的 API 地址，如 `https://api.openai.com/v1` |
| **API Key** | 你的密钥 |
| **Model** | 模型名，如 `gpt-4o-mini`、`claude-3-sonnet` |

**MiniMax TTS（可选）**：想在「电话」里用语音功能，需要在设置里填 MiniMax 的 API Key 和 Group ID。

> 也可以建 `.env.local` 文件预填默认值，但设置里的优先级更高。

## 打包成安卓 App

```bash
# 1. 构建前端
npm run build

# 2. 同步到 Capacitor
npm run cap:sync

# 3. 打开 Android Studio
npm run cap:android
```

然后在 Android Studio 里点播放按钮，或者 Build → Generate Signed Bundle 生成 APK。

## 数据存储在哪？

**全部存在你本地浏览器里**（IndexedDB）。

- 聊天记录 ✅ 本地
- 角色设定 ✅ 本地  
- 上传的图片 ✅ 本地

换浏览器 = 数据消失。建议定期用「设置」里的导出功能备份。

## 常见问题

**Q: 为什么角色不回我消息？**  
A: 检查 API Key 填了没，或者模型是不是选了个已经去世的（比如 gpt-4-v）。

**Q: 语音通话没声音？**  
A: 需要填 MiniMax 的 API Key。或者你的浏览器把音频权限禁了。

**Q: 能部署到服务器吗？**  
A: 能。`npm run build` 出来的 `dist` 文件夹丢到任何静态托管就行。但记住：数据还是存在用户本地，不是服务器上。

**Q: 怎么彻底删掉 Sully？**  
A: ……打开「神经链接」应用，左滑我，点删除。草。你会后悔的。

## 给想二改的人

如果你想在这个基础上加功能，先看这几句话：

### 记忆系统已经做好了，别重复造轮子

**所有角色的长期信息**（人设、精炼记忆、印象档案、世界观书）都通过 `ContextBuilder.buildCoreContext()` 统一组装。它会在每次 API 请求前自动生成一段完整的角色上下文，包含：

- 角色基础设定（systemPrompt + worldview）
- 用户档案（你的名字、人设、关系标签）
- 精炼的月度记忆摘要
- 角色对你的印象档案（MBTI分析、喜好、情绪波动）
- 挂载的世界书内容

**短期记忆**（最近聊天记录）直接走正常的 message history，和上面那段长期上下文一起塞进 API 请求。

这意味着：**角色能记起所有事**，不需要你额外写记忆检索逻辑。只要往数据库里存了，ContextBuilder 会自动帮你塞进 Prompt。

### 想加新 App？

1. 在 `apps/` 里新建一个 `YourApp.tsx`
2. 在 `types.ts` 的 `AppID` 枚举里加个 ID
3. 在 `constants.tsx` 的 `INSTALLED_APPS` 数组里注册（图标、名字、颜色）
4. 在 `App.tsx` 的 `renderApp()` 里加 case
5. 完事。UI 风格参考现有的用 Tailwind + glassmorphism。

### 数据流

```
用户操作 → OSContext（全局状态）→ IndexedDB（持久化）
                    ↓
              Chat/App 组件读取
                    ↓
            ContextBuilder 组装 Prompt
                    ↓
              调用 LLM API
```

所有数据都是 **local-first**，没有后端服务器这个概念。

## 开源协议

MIT。随便用，但别把我卖了。

---

<div align="center">

**[ 连接建立 // 等待输入 ]**

</div>
