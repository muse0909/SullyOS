/**
 * 剧场的实时模型配置（10-06 22:25，独立于聊天的主 API）。
 *
 * ## 为什么必须独立
 *
 * 原来我图省事，直接借了主 API 的密钥。暮色当场指出：主聊天用别的模型，
 * 只有剧场要用 live 模型 —— 借来的配置既不是 live 的、也跟主聊天互相牵连。
 * 他聊天哪天换成中转站，剧场这边立刻就挂，而且根本想不到是这个原因。
 *
 * 所以剧场自己一份：地址 + 密钥 + 模型。
 *
 * ## 为什么没有「协议切换」那个 tab
 *
 * 主聊天有 OpenAI / Claude / Gemini 三套，是走 HTTP `/chat/completions` 那类接口。
 * **Live 协议只有 Google 官方有**：它是 WebSocket 双向流，中转站不做这个
 * （文档里只有 `generativelanguage.googleapis.com` 一个端点）。
 * 所以这里固定一种，也就不存在 `APIConfig` 那个「同一字段存两套名字、按协议归一化」
 * 的老问题（`AGENTS.md` §4.5），**存一套字段就够，少一半心智负担**。
 *
 * ⚠️ 但地址仍然留成可填的：不是为了换协议，是为了 Google 万一改域名时不用改代码。
 */

export const LIVE_WS_BASE =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

export type TheaterLiveConfig = {
  /** WebSocket 端点。默认就是官方那个，一般不用改 */
  baseUrl: string;
  /** Google AI Studio 的密钥（AIza 开头） */
  apiKey: string;
  /** 模型名。live 只有 Google 官方这几个 */
  model: string;
};

const KEY = 'os_theater_live_config';

export const defaultLiveConfig: TheaterLiveConfig = {
  baseUrl: LIVE_WS_BASE,
  apiKey: '',
  model: 'gemini-3.8-live',
};

export function loadLiveConfig(): TheaterLiveConfig {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return { ...defaultLiveConfig };
    // ⚠️ 逐字段合并，不要 {...default, ...JSON.parse(s)} 整体覆盖 ——
    // 老版本存的配置可能少字段，整体覆盖会把默认值抹掉。
    const j = JSON.parse(s) || {};
    return {
      baseUrl: j.baseUrl || defaultLiveConfig.baseUrl,
      apiKey: j.apiKey || '',
      model: j.model || defaultLiveConfig.model,
    };
  } catch {
    return { ...defaultLiveConfig };
  }
}

export function saveLiveConfig(cfg: TheaterLiveConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
    // 换个事件名，别蹭全局的 bus —— 剧场这个配置只有剧场自己用
    window.dispatchEvent(new CustomEvent('os_theater_live_config_changed'));
  } catch {}
}

export function subscribeLiveConfig(cb: () => void): () => void {
  const onEvt = () => cb();
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) cb(); };
  window.addEventListener('os_theater_live_config_changed', onEvt);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener('os_theater_live_config_changed', onEvt);
    window.removeEventListener('storage', onStorage);
  };
}

/** 密钥脱敏：任何对外输出都不许出现完整 key */
export function maskLiveKey(k: string): string {
  if (!k) return '(没填)';
  if (k.length <= 10) return `${k.slice(0, 3)}…`;
  return `${k.slice(0, 6)}…${k.slice(-4)}`;
}
