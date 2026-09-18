// utils/coReadHelperLogger.ts
// 麦麦 2026-09-18 第 5 步：帮工调用日志记账
//   startLog(type, bookTitle?) → 返回一个 endLog(success, usage, error?) 函数
//   endLog 自动算 durationMs + 估算花费 + 写 IDB
//   价格表:DeepSeek-V3 标准价;未知名模型 fallback 默认价
//   写日志是 fire-and-forget,不阻塞主调用流程

import { DB, CoReadHelperLog } from './db';

// 价格表(美元/百万 tokens),按模型常见价
const PRICE_TABLE: Record<string, { input: number; output: number }> = {
  'deepseek-chat': { input: 0.27, output: 1.10 },         // DeepSeek-V3 标准价 (cache miss)
  'deepseek-v3': { input: 0.27, output: 1.10 },
  'deepseek-v2.5': { input: 0.27, output: 1.10 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'minimax-text-01': { input: 0.20, output: 0.80 },
  'claude-3-5-sonnet': { input: 3.00, output: 15.00 },
};
const DEFAULT_PRICE = { input: 1.00, output: 3.00 };

function estimateCost(model: string | undefined, promptTokens: number, completionTokens: number): number {
  const price = (model && PRICE_TABLE[model.toLowerCase()]) || DEFAULT_PRICE;
  const usd = (promptTokens * price.input + completionTokens * price.output) / 1_000_000;
  // 保留 6 位精度(避免浮点尾巴)
  return Math.round(usd * 1_000_000) / 1_000_000;
}

interface StartedLog {
  type: CoReadHelperLog['type'];
  method: 'helper-llm'; // 第 5 步只记 helper-llm 类型
  bookTitle?: string;
  model?: string;
  startMs: number;
}

/**
 * 开始一次帮工调用,返回收尾函数
 *   const end = startCoReadHelperLog({...});
 *   ... do call ...
 *   end({ ok, usage, error });
 */
export function startCoReadHelperLog(opts: {
  type: CoReadHelperLog['type'];
  bookTitle?: string;
  model?: string;
}): (result: {
  ok: boolean;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  error?: string;
}) => void {
  const started: StartedLog = {
    type: opts.type,
    method: 'helper-llm',
    bookTitle: opts.bookTitle,
    model: opts.model,
    startMs: Date.now(),
  };
  return (res) => {
    const durationMs = Date.now() - started.startMs;
    const costUsd =
      typeof res.promptTokens === 'number' && typeof res.completionTokens === 'number'
        ? estimateCost(started.model, res.promptTokens, res.completionTokens)
        : undefined;
    const entry: Omit<CoReadHelperLog, 'id'> = {
      timestamp: Date.now(),
      type: started.type,
      bookTitle: started.bookTitle,
      method: started.method,
      success: res.ok,
      durationMs,
      promptTokens: res.promptTokens,
      completionTokens: res.completionTokens,
      totalTokens: res.totalTokens,
      costUsd,
      error: res.error,
      model: started.model,
    };
    // fire-and-forget — 写日志失败不影响主流程
    DB.saveCoReadHelperLog(entry).catch((e) => {
      console.warn('[coread] save helper log failed:', e);
    });
  };
}

/**
 * 工作台统计聚合
 *   getCoReadHelperStats() 从 DB 拉所有日志算总调用/总 tokens/总费用/失败率
 */
export interface CoReadHelperStats {
  totalCalls: number;
  successCalls: number;
  failureCalls: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  totalDurationMs: number;
  byBook: Array<{
    bookTitle: string;
    calls: number;
    successCalls: number;
    failureCalls: number;
    totalTokens: number;
    totalCostUsd: number;
    lastCallAt: number;
  }>;
}

export async function getCoReadHelperStats(): Promise<CoReadHelperStats> {
  const logs = await DB.getCoReadHelperLogs();
  const stats: CoReadHelperStats = {
    totalCalls: logs.length,
    successCalls: 0,
    failureCalls: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    totalDurationMs: 0,
    byBook: [],
  };
  const byBookMap = new Map<string, { calls: number; successCalls: number; failureCalls: number; totalTokens: number; totalCostUsd: number; lastCallAt: number }>();
  for (const log of logs) {
    if (log.success) stats.successCalls += 1;
    else stats.failureCalls += 1;
    stats.totalPromptTokens += log.promptTokens || 0;
    stats.totalCompletionTokens += log.completionTokens || 0;
    stats.totalTokens += log.totalTokens || log.promptTokens || 0;
    stats.totalCostUsd += log.costUsd || 0;
    stats.totalDurationMs += log.durationMs || 0;
    const key = log.bookTitle || '(未关联书)';
    const cur = byBookMap.get(key) || {
      calls: 0, successCalls: 0, failureCalls: 0, totalTokens: 0, totalCostUsd: 0, lastCallAt: 0,
    };
    cur.calls += 1;
    if (log.success) cur.successCalls += 1; else cur.failureCalls += 1;
    cur.totalTokens += log.totalTokens || log.promptTokens || 0;
    cur.totalCostUsd += log.costUsd || 0;
    cur.lastCallAt = Math.max(cur.lastCallAt, log.timestamp || 0);
    byBookMap.set(key, cur);
  }
  stats.byBook = Array.from(byBookMap.entries())
    .map(([bookTitle, v]) => ({ bookTitle, ...v }))
    .sort((a, b) => b.lastCallAt - a.lastCallAt);
  // 保留精度
  stats.totalCostUsd = Math.round(stats.totalCostUsd * 1_000_000) / 1_000_000;
  return stats;
}
