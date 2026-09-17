/**
 * 主动消息 2.0 暂停开关
 *
 * 暮色 2026-08-09:切换 1.0 / 2.0 跑哪个的入口
 *   AMSG2_ENABLED = true  : 2.0 完整运行(Cloudflare Worker + Web Push + amsg2 工具类 + Settings 入口)
 *   AMSG2_ENABLED = false : 1.0 唯一入口;2.0 接入点(proactiveChat 3 处、OSContext 事件监听、Settings 入口)全部短路
 *
 * 改这一处 = 切换 1.0 / 2.0,不需要改 4 处调用点。
 * 配套 2.0 代码 / 配置 / 组件文件全部保留,只是不跑。
 *
 * 暮色 2026-09-17 21:53：例外 — schedule_next_wakeup 不受这个开关管。
 *   角色在聊天里用 [schedule_next_wakeup | 时间 | reason] token 排的唤醒任务，
 *   由 hooks/useChatAI.ts 解析后直接调 utils/proactivePushConfig.registerCharacterWakeup
 *   写入主动消息 2.0，那条链路完全不查 AMSG2_ENABLED。
 *   理由：开关只管自动模式 (proactiveChat 接入) 和事件通道 (OSContext)；
 *   角色自己安排的唤醒属于"角色行为"，即使总开关关了也该照常生效。
 */
export const AMSG2_ENABLED = false;
