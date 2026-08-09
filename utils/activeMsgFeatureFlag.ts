/**
 * 主动消息 2.0 暂停开关
 *
 * 暮色 2026-08-09:切换 1.0 / 2.0 跑哪个的入口
 *   AMSG2_ENABLED = true  : 2.0 完整运行(Cloudflare Worker + Web Push + amsg2 工具类 + Settings 入口)
 *   AMSG2_ENABLED = false : 1.0 唯一入口;2.0 接入点(proactiveChat 3 处、OSContext 事件监听、Settings 入口)全部短路
 *
 * 改这一处 = 切换 1.0 / 2.0,不需要改 4 处调用点。
 * 配套 2.0 代码 / 配置 / 组件文件全部保留,只是不跑。
 */
export const AMSG2_ENABLED = false;
