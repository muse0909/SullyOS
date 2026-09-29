/**
 * 「聊天 API 按协议归一化」——全项目**唯一**的一份规则。
 *
 * ## 要解决的问题
 *
 * APIConfig 里同一个逻辑字段存了两套名字（types.ts 的 protocol 注释）：
 *   - OpenAI 协议 → baseUrl / apiKey / model
 *   - Gemini 协议 → geminiBaseUrl / geminiApiKey / geminiModel
 *
 * 设置页保存时会按当前协议只写「那一套」，另一套清空（Settings.handleSaveMainApi、
 * ApiQuickFloat 都是这个规矩）。所以 `protocol === 'gemini'` 时 `apiConfig.baseUrl`
 * **是空的**，真配置在 gemini* 三个字段里。
 *
 * 而全项目有 100 多处按「OpenAI 那种调法」发请求——读 `apiConfig.baseUrl` + 拼
 * `/chat/completions` + `Authorization: Bearer`。这些地方全都没判协议，于是 Gemini
 * 直连的用户一进去就报「请先在设置里配置聊天 API URL」（2026-09-30 暮色在打电话里
 * 先撞上；点哪坏哪，因为它压根不读 gemini* 字段）。
 *
 * 逐个改 100 多处不现实——下一个人加新功能还会再犯一次。这里改成**在数据出口归一化**：
 * 交给使用方的那份 apiConfig，baseUrl/apiKey/model 一律是「当前协议真正生效」的值。
 * 100 多处一行都不用改，新功能也不用记。
 *
 * ## Gemini 为什么要补 /openai
 *
 * Google 官方除了原生的 `:generateContent`，还提供一层 OpenAI 兼容端点：
 *   POST https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
 * 鉴权头（`Authorization: Bearer`）和请求体（`{model, messages}`）跟 OpenAI 一模一样。
 * 所以只要把 geminiBaseUrl 补上 `/openai`，那 100 多处「OpenAI 那种调法」不用改一行
 * 就能通。走原生 `:generateContent` 的地方（OSContext 主动消息、记忆宫殿 llmCall）
 * 不经过这个函数，行为不变。
 *
 * 参考：主动消息 2.0 的 worker 早就这么干了（见 amsgLlmCredentials.resolveAmsgApiTriplet，
 * 本文件是把它那套规则抽出来共用，不是新发明）。
 *
 * ## 为什么 /v1 那个补全函数也得一起改
 *
 * 项目里到处是 `normalizeApiUrl()`：地址不以 `/v数字` 结尾就补 `/v1`，防中转站根路径 404。
 * 但 Gemini 的地址是 `.../v1beta`，`v1beta` 不是 `v1`（正则 `/\/v\d+$/` 匹配不上）
 * → 补完变成 `.../v1beta/v1`，Google 那边没这个路径。补上 `/openai` 之后也一样会被补成
 * `.../v1beta/openai/v1`。所以本文件同时提供 `normalizeChatBaseUrl()`，对 Gemini 形状的
 * 地址不补 `/v1`。**两个函数必须成对使用**，只归一化地址不改补全逻辑（或反过来）都会打错。
 */

import type { APIConfig } from '../types';

/**
 * 能带协议的那一份配置。真实的 APIConfig 有 protocol + gemini* 三个字段；
 * 角色独立 API、副 API、预设这些「只有 baseUrl/apiKey/model」的子集也喂得进来
 * （它们没有 protocol，按 OpenAI 处理，正是原来的行为）。
 */
export type MaybeProtocolApi = Partial<APIConfig> & {
  geminiBaseUrl?: string;
  geminiApiKey?: string;
  geminiApiKeys?: string[];
  geminiModel?: string;
};

type Loose = Record<string, unknown>;

const asLoose = (v: unknown): Loose =>
  (v && typeof v === 'object' ? v : {}) as Loose;

/** 结尾是 `openai` 的 = 已经指向 Google 的 OpenAI 兼容层了，不要再补。 */
const GEMINI_COMPAT_TAIL = /\/openai$/i;
/** 结尾是 `v1` / `v1beta` / `v1alpha` 这类版本段的——补 `/v1` 只会打错。 */
const GEMINI_VERSION_TAIL = /\/v\d+(?:beta|alpha)?$/i;

/** 这个地址是不是已经指向 Google 的 OpenAI 兼容层。 */
export const isGeminiOpenAiCompatUrl = (url?: string): boolean =>
  GEMINI_COMPAT_TAIL.test((url || '').trim().replace(/\/+$/, ''));

/**
 * 补上 Google 的 OpenAI 兼容层后缀。用户自己填过 `/openai` 的不重复补。
 */
export const withGeminiOpenAiSuffix = (url?: string): string => {
  const raw = (url || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return isGeminiOpenAiCompatUrl(raw) ? raw : `${raw}/openai`;
};

/**
 * 聊天 baseUrl 的补全——**`normalizeApiUrl` 的 Gemini 感知版**，行为在 OpenAI 下完全一致。
 *
 * 原来的规矩：结尾不是 `/v数字` 就补 `/v1`。这里多一条：结尾是 `/v1beta`、`/v1alpha`
 * 或 `/openai` 的（Gemini 形状）原样返回，不补 `/v1`。
 */
export const normalizeChatBaseUrl = (url?: string): string => {
  const raw = (url || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  if (/\/v\d+$/i.test(raw)) return raw;
  if (GEMINI_VERSION_TAIL.test(raw)) return raw;
  if (GEMINI_COMPAT_TAIL.test(raw)) return raw;
  return `${raw}/v1`;
};

/**
 * 取「当前协议真正生效」的那一套字段。
 *
 * 读字段的口径跟设置页、主动消息那边一致：
 *   - 非 Gemini → baseUrl / apiKey / model（缺项不猜，别的一律回落主字段）
 *   - Gemini    → gemini* 优先，缺项才回落主字段（主字段可能还留着上一次 OpenAI 的值）
 *
 * 密钥池的取法跟 extractGeminiKeys 一致：数组优先，回落单字符串。
 *
 * 缺字段时**照样返回**（空字符串占位），要不要判「不完整」由调用方按自己的语义决定
 * （下面 `resolveAmsgApiTriplet` 就要判）。字段为空不代表调用失败。
 */
export const resolveChatApiTriplet = (
  source: MaybeProtocolApi | null | undefined,
): { baseUrl: string; apiKey: string; model: string } => {
  if (!source) return { baseUrl: '', apiKey: '', model: '' };
  const loose = asLoose(source);
  if (source.protocol !== 'gemini') {
    return {
      baseUrl: source.baseUrl || '',
      apiKey: source.apiKey || '',
      model: source.model || '',
    };
  }
  const pool = Array.isArray(loose.geminiApiKeys) ? (loose.geminiApiKeys as unknown[]) : [];
  const fromPool = pool.find((k) => typeof k === 'string' && k.trim());
  return {
    baseUrl: withGeminiOpenAiSuffix(loose.geminiBaseUrl as string || source.baseUrl || ''),
    apiKey: (fromPool as string) || (loose.geminiApiKey as string) || source.apiKey || '',
    model: (loose.geminiModel as string) || source.model || '',
  };
};

/** 三件套齐了才算配好了（少一样请求发出去必然失败）。 */
export const isUsableChatApi = (
  api: { baseUrl?: string; apiKey?: string; model?: string } | null | undefined,
): boolean => !!(api?.baseUrl && api.model);

/**
 * 把当前协议生效的值**映**进 baseUrl / apiKey / model 三个字段，原对象原样返回（类型不变）。
 *
 * 为什么是「映」而不是「换」：Gemini 原生调用（`:generateContent`）读的是 gemini* 字段，
 * 那些地方必须还能拿到原值。映一份过去，两种读法同时成立，谁都不用改。
 *
 * 非 Gemini 时**返回原对象引用**（不是副本）——绝大多数用户的 config 对象身份不变，
 * 依赖引用比较的 memo / effect 不会被白白打醒。
 */
export const withEffectiveChatApi = <T extends MaybeProtocolApi>(config: T): T => {
  if (!config || config.protocol !== 'gemini') return config;
  const effective = resolveChatApiTriplet(config);
  if (!effective.baseUrl) return config;
  return {
    ...config,
    baseUrl: effective.baseUrl,
    apiKey: effective.apiKey,
    model: effective.model,
  } as T;
};
