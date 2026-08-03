// 暮色 2026-08-04：Gemini 直连 key 池 — 轮询 + 健康状态管理
//   - 3 个 channel 独立维护：'main'（主 API）/ 'vision'（识图）/ 'light'（记忆宫殿副 API）
//   - key 池配置存在 apiConfig（持久化）；运行时状态（cursor/cooldown）module-level（不持久化）
//   - 失败策略：429 配额耗尽切下一个 + 标 60 秒不重用 / 401 key 失效标 dead + 弹 toast 不重试 / 其他切下一个 + 标 5 秒不重用
//   - UI 接口：getGeminiKeyStatuses() 给"key 池管理"弹窗显示状态灯

export type GeminiChannel = 'main' | 'vision' | 'light';

export type GeminiKeyStatus = 'active' | 'rate-limited' | 'dead';

export interface GeminiKeyState {
  // key 字符串本身（用前 4 后 4 短码做 UI 显示的唯一标识）
  key: string;
  status: GeminiKeyStatus;
  // 限流解除时间（Unix ms），cooldown 内不会再被选中
  cooldownUntil?: number;
  // 上次失败原因（限流/失效/网络）
  lastError?: string;
  // 上次失败时间
  lastErrorAt?: number;
  // 累计成功次数
  successCount: number;
  // 累计失败次数
  failCount: number;
}

interface ChannelState {
  // key 数组（按 config 顺序），每次 config 变就重建
  keys: GeminiKeyState[];
  // 当前 cursor（指向"下次该用"的 key 索引）
  cursor: number;
  // 上次 cursor 指向的 key 索引（用于重试切下一个）
  lastUsedIndex: number;
}

const channelState = new Map<GeminiChannel, ChannelState>();

// 限流冷却时间（毫秒）
const RATE_LIMIT_COOLDOWN_MS = 60_000; // 60 秒
// 其他错误冷却时间（毫秒）
const NETWORK_COOLDOWN_MS = 5_000; // 5 秒

// 把 APIConfig 里的 key 数组同步到 channelState
//   暮色 2026-08-04：每次调用前同步，避免 UI 改了 key 池但状态没更新
function syncChannelState(channel: GeminiChannel, rawKeys: string[]): ChannelState {
  // 过滤空字符串 + 去重
  const cleanKeys = Array.from(new Set(rawKeys.map(k => (k || '').trim()).filter(Boolean)));
  const existing = channelState.get(channel);

  if (existing && existing.keys.length === cleanKeys.length &&
      existing.keys.every((s, i) => s.key === cleanKeys[i])) {
    // 顺序 + 数量都没变，复用现有 cursor
    return existing;
  }

  // 顺序/数量变了：尽量保留老 key 的状态（按 key 字符串匹配）
  const oldStateMap = new Map<string, GeminiKeyState>();
  if (existing) {
    existing.keys.forEach(s => oldStateMap.set(s.key, s));
  }
  const newKeys: GeminiKeyState[] = cleanKeys.map(k => {
    const old = oldStateMap.get(k);
    if (old) return old;
    return {
      key: k,
      status: 'active',
      successCount: 0,
      failCount: 0,
    };
  });

  const newState: ChannelState = {
    keys: newKeys,
    cursor: 0,
    // 上次用到的索引：尽量保持连续（如果原来 cursor=2 用过，新数组长度变了，从 0 开始也行）
    lastUsedIndex: -1,
  };
  channelState.set(channel, newState);
  return newState;
}

// 从 APIConfig 提取 key 数组（兼容老字段 geminiApiKey 单字符串）
export function extractGeminiKeys(
  config: any,
  fieldName: 'geminiApiKey' | 'visionGeminiApiKey',
  arrayFieldName: 'geminiApiKeys' | 'visionGeminiApiKeys',
): string[] {
  if (Array.isArray(config?.[arrayFieldName]) && config[arrayFieldName].length > 0) {
    return config[arrayFieldName].map((k: string) => (k || '').trim()).filter(Boolean);
  }
  // 兼容老数据：单字符串字段
  const single = config?.[fieldName];
  if (single && typeof single === 'string' && single.trim()) {
    return [single.trim()];
  }
  return [];
}

// 取一个可用 key（轮询 + 跳过限流/失效的）
//   返回 null 表示池里所有 key 都被限流/失效了
export function pickGeminiKey(
  channel: GeminiChannel,
  keys: string[],
): { key: string; keyIndex: number; totalKeys: number } | null {
  if (keys.length === 0) return null;
  const state = syncChannelState(channel, keys);
  const now = Date.now();

  // 找下一个"可用"的 key（从 cursor 开始轮一圈）
  const n = state.keys.length;
  for (let i = 0; i < n; i++) {
    const idx = (state.cursor + i) % n;
    const s = state.keys[idx];
    if (s.status === 'dead') continue;
    if (s.status === 'rate-limited' && s.cooldownUntil && s.cooldownUntil > now) continue;
    // 找到了：更新 cursor 到这个位置 +1（下次从这开始）
    state.cursor = (idx + 1) % n;
    state.lastUsedIndex = idx;
    return { key: s.key, keyIndex: idx, totalKeys: n };
  }
  return null;
}

// 上报失败：标记当前 key 状态 + 给上层决定要不要重试
//   - status === 429 → rate-limited，60 秒内不重用
//   - status === 401 / 403 → dead（不重用，弹 toast）
//   - 其他 → rate-limited 5 秒
//   返回 'retry' | 'fail-permanent' | 'fail-recoverable'
//     - 'retry': 上层可以用下一个 key 重试
//     - 'fail-permanent': 401 类，key 永久失效，不重试，弹 toast
//     - 'fail-recoverable': 所有 key 都限流了，不重试但等会儿会自动恢复
export function reportGeminiFailure(
  channel: GeminiChannel,
  keyIndex: number,
  status: number,
  errText: string,
): 'retry' | 'fail-permanent' | 'fail-recoverable' {
  const state = channelState.get(channel);
  if (!state || !state.keys[keyIndex]) return 'fail-permanent';
  const s = state.keys[keyIndex];
  const now = Date.now();

  s.failCount += 1;
  s.lastErrorAt = now;
  // 截断错误文本（不要全存，浪费内存）
  s.lastError = errText.slice(0, 120);

  if (status === 401 || status === 403) {
    s.status = 'dead';
    // dead key 不设 cooldown（永久）
    return 'fail-permanent';
  }
  if (status === 429) {
    s.status = 'rate-limited';
    s.cooldownUntil = now + RATE_LIMIT_COOLDOWN_MS;
    return 'retry';
  }
  // 其他：网络错误 / 5xx
  s.status = 'rate-limited';
  s.cooldownUntil = now + NETWORK_COOLDOWN_MS;
  return 'retry';
}

// 上报成功：清掉 rate-limited 状态 + 累计成功次数
export function reportGeminiSuccess(channel: GeminiChannel, keyIndex: number) {
  const state = channelState.get(channel);
  if (!state || !state.keys[keyIndex]) return;
  const s = state.keys[keyIndex];
  s.successCount += 1;
  s.status = 'active';
  s.cooldownUntil = undefined;
  s.lastError = undefined;
}

// UI 用：拿所有 key 状态给"key 池"弹窗显示
export function getGeminiKeyStatuses(
  channel: GeminiChannel,
  keys: string[],
): GeminiKeyState[] {
  syncChannelState(channel, keys);
  const state = channelState.get(channel);
  if (!state) return [];
  return state.keys.map(s => ({ ...s }));
}

// UI 用：手动重置某个 key（把 dead 改回 active）
export function resetGeminiKeyStatus(channel: GeminiChannel, keyIndex: number) {
  const state = channelState.get(channel);
  if (!state || !state.keys[keyIndex]) return;
  const s = state.keys[keyIndex];
  s.status = 'active';
  s.cooldownUntil = undefined;
  s.lastError = undefined;
}

// UI 用：key 字符串短码（AIza...abc）用于列表显示
export function shortKey(key: string): string {
  if (!key) return '';
  if (key.length <= 12) return key;
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

// UI 用：状态 → 颜色（暮色马卡龙色系：active=绿/rate-limited=黄/dead=红）
export function statusColor(status: GeminiKeyStatus): { dot: string; text: string; label: string } {
  switch (status) {
    case 'active':
      return { dot: 'bg-emerald-400', text: 'text-emerald-600', label: '可用' };
    case 'rate-limited':
      return { dot: 'bg-amber-400', text: 'text-amber-600', label: '限流冷却' };
    case 'dead':
      return { dot: 'bg-rose-400', text: 'text-rose-600', label: '已失效' };
  }
}
