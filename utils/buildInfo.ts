/**
 * 构建版本相关常量的单一来源。
 *
 * `__BUILD_BRANCH__` / `__BUILD_COMMIT__` / `__BUILD_TIME__`
 * 是 vite.config.ts 注入的全局常量（prod 也有真值），
 * 但「branch@commit」这个 user-facing 标签字符串原本在 BuildBadge / VersionInfo / DevDebugPanel
 * 三处分别现拼，想加 dirty 标、截短 commit 之类要改三处——抽到这里集中维护。
 */

/** "branch@shortCommit" 形式的构建标签；BuildBadge 角标、设置页 VersionInfo、调试面板都用这一份。 */
export const BUILD_LABEL = `${__BUILD_BRANCH__}@${__BUILD_COMMIT__}`;

/** 构建时间标签，固定由 Vite 按 UTC+8 注入，避免受用户本机时区影响。 */
export const BUILD_TIME_LABEL = __BUILD_TIME__;

/** 设置页底部的产品版本名（手工维护），跟构建 hash 是两码事——发版前改这里。 */
export const APP_VERSION = 'v3.9.2 (MCP)';

/**
 * 版本号那半截（`v3.0`）。统计给每条记录打的标签用它，面板里按版本切分数据时
 * 标签越短越好筛，代号留给设置页展示。跟着 APP_VERSION 走，改一处就够。
 */
export const APP_VERSION_TAG = APP_VERSION.split(' ')[0];

/**
 * **浏览器实际连着的网址**（麦麦 2026-10-03 新增）。
 *
 * ## 为什么必须跟 BUILD_LABEL 一起看
 *
 * 2026-10-03 出过一次很难查的事故：暮色在 fix 分支上改主动消息的 11 步规则、打了
 * 测试包装到手机上测，**屏幕上跑的却是 master 的代码**。根因是 capacitor.config.json
 * 写着 server.url，Capacitor 从远程加载网页，APK 里那份本地 assets 根本不参与
 * （现在 android/app/build.gradle 按 -PtestBuild 选两份 config，见那里的注释）。
 *
 * 两个值说的是两件事，必须对着看：
 *   - BUILD_LABEL ——「**这份网页代码**是从哪个分支哪个 commit 构建的」
 *     （Vercel 上走 vite.config.ts 的 VERCEL_GIT_COMMIT_REF / _SHA，见那里 readBranch/readCommit）
 *   - LOADED_HOST ——「**手机现在到底在连哪个站点**」
 *
 * 对上的组合：
 *   master@ef17e1aa   + sully-muse-vert…              → 正式版，正常
 *   fix/amsg2-realign@97baae5 + sully-os-git-fix-…      → 测试版，正常
 *   master@ef17e1aa   + sully-os-git-fix-…              → **域名指错了**，
 *     分支部署了但 app 还连着老域名（或者反过来）——那天事故就是这个形态
 *
 * 读 location.host 而不是写死配置里的 server.url：前者是浏览器实际连的，
 * 中间有没有 service worker 缓存、有没有跳转，它都算得准。
 *
 * 非浏览器环境（node / 单元测试）返回 null，调用方要能处理 null。
 */
export const LOADED_HOST: string | null = (() => {
  try {
    if (typeof window === 'undefined' || !window.location) return null;
    return window.location.host || null;
  } catch {
    return null;
  }
})();

