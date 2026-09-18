// utils/coReadHelperConfig.ts
// 麦麦 2026-09-18 第 4 步：共读拆章兜底帮工 API 配置
//   暮色原话：「可以获取主 API 预设」
//   含义：帮工 API 默认从 Chat API 配置复用,可独立改字段(独立 baseUrl / model 等)
//   存在 localStorage — 配置项,备份恢复重要性低,不用折腾 IDB schema

export interface CoReadHelperConfig {
  enabled: boolean;          // 总开关：是否启用帮工兜底(本地全部失败时才用)
  inheritFromMain: boolean;  // 是否复用 Chat API (useOS apiConfig) — 改字段时只动这个独立字段
  baseUrl: string;           // 独立 baseUrl (inheritFromMain=false 时生效)
  apiKey: string;            // 独立 apiKey
  model: string;             // 帮工用的模型 (默认 deepseek-chat / deepseek-v3 之类)
  protocol: 'openai' | 'gemini'; // 协议 — 跟主 API 对齐
  timeoutMs: number;         // 超时(毫秒),默认 30000
}

const STORAGE_KEY = 'co_read_helper_config_v1';

export const DEFAULT_HELPER_CONFIG: CoReadHelperConfig = {
  enabled: false,            // 默认关闭 — 用户进高级页签手动开
  inheritFromMain: true,     // 默认复用主 API
  baseUrl: '',
  apiKey: '',
  model: 'deepseek-chat',
  protocol: 'openai',
  timeoutMs: 30000,
};

export function loadHelperConfig(): CoReadHelperConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      // 宽松合并 — 新增字段用默认值
      return { ...DEFAULT_HELPER_CONFIG, ...obj };
    }
  } catch {}
  return { ...DEFAULT_HELPER_CONFIG };
}

export function saveHelperConfig(cfg: CoReadHelperConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch (e) {
    console.warn('[coread] saveHelperConfig failed:', e);
  }
}

export function resetHelperConfig(): CoReadHelperConfig {
  saveHelperConfig(DEFAULT_HELPER_CONFIG);
  return { ...DEFAULT_HELPER_CONFIG };
}

/**
 * 解析"复用主 API"配置 — 把 useOS apiConfig 同步到 helperConfig
 *   inheritFromMain=true 时,每次调用前都用 mainApi 给的 baseUrl/apiKey/model
 *   inheritFromMain=false 时,用 helperConfig 自己的 baseUrl/apiKey/model
 */
export interface MainApiConfigForHelper {
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol: 'openai' | 'gemini';
}

/**
 * 把 helperConfig + 主 API 合并成最终调用参数
 */
export function resolveHelperCallConfig(
  helper: CoReadHelperConfig,
  mainApi: MainApiConfigForHelper | null,
): {
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol: 'openai' | 'gemini';
  timeoutMs: number;
  enabled: boolean;
} {
  if (helper.inheritFromMain && mainApi && mainApi.baseUrl && mainApi.apiKey) {
    return {
      baseUrl: mainApi.baseUrl,
      apiKey: mainApi.apiKey,
      model: helper.model || mainApi.model || 'deepseek-chat',
      protocol: mainApi.protocol || 'openai',
      timeoutMs: helper.timeoutMs,
      enabled: helper.enabled,
    };
  }
  return {
    baseUrl: helper.baseUrl,
    apiKey: helper.apiKey,
    model: helper.model || 'deepseek-chat',
    protocol: helper.protocol,
    timeoutMs: helper.timeoutMs,
    enabled: helper.enabled,
  };
}
