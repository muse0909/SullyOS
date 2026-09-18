// utils/coReadHelperClient.ts
// 麦麦 2026-09-18 第 4 步：调兜底帮工识别章节标题
//
// 关键设计：只发"疑似标题的短行 + 行号"，**不发全文** — 隐私 + 便宜
//   候选从 utils/coReadChapterParser.extractTitleCandidates 拿(每个 < 60 字符)
//
// 协议：跟 Chat API 同款 OpenAI 兼容 / Gemini 同款
//   用 Chat 已有的 fetch 流调用 — 这里写一个简版,不重依赖 Chat 上下文

import type { CoReadHelperConfig, MainApiConfigForHelper } from './coReadHelperConfig';
import { resolveHelperCallConfig } from './coReadHelperConfig';

export interface CandidateLine {
  lineNo: number;
  preview: string;
}

export interface HelperCallResult {
  ok: boolean;
  titleLineNos?: number[];     // 帮工认出来的章节标题行号
  rawResponse?: string;        // 帮工的原始回包(成功失败都记,日志用)
  error?: string;              // 错误信息(失败时)
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

/**
 * 调用帮工,识别章节标题
 * @param candidates 已本地过滤的"疑似标题"短行列表(< 200 行)
 * @param totalLines 全书总行数(帮工需要这个上下文)
 * @param cfg helperConfig
 * @param mainApi 主 API(供 inheritFromMain 用)
 */
export async function callHelperForChapterTitles(
  candidates: CandidateLine[],
  totalLines: number,
  cfg: CoReadHelperConfig,
  mainApi: MainApiConfigForHelper | null,
): Promise<HelperCallResult> {
  const resolved = resolveHelperCallConfig(cfg, mainApi);
  if (!resolved.enabled) {
    return { ok: false, error: '帮工未启用' };
  }
  if (!resolved.baseUrl || !resolved.apiKey) {
    return { ok: false, error: '基础地址或接口密钥为空' };
  }
  if (candidates.length === 0) {
    return { ok: false, error: '没有候选标题行可分析' };
  }

  // 组 prompt — 用中文 prompt,让 deepseek 这种中文模型更准
  const systemPrompt =
    '你的任务是从给定的"疑似章节标题候选行"中,挑出真正像章节标题的行,按 JSON 数字数组返回行号。\n' +
    '只返回 JSON 数组,不要解释、代码块或其他内容。例如: [5, 12, 23, 35]';

  const userPrompt =
    `总行数: ${totalLines}\n\n` +
    `候选标题行(已是行号 + 短预览):\n` +
    candidates.map((c) => `${c.lineNo}: ${c.preview}`).join('\n') +
    '\n\n请返回真正是章节标题的行号数组(JSON 格式):';

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), resolved.timeoutMs || 30000);

    // OpenAI 兼容协议 — minimax / deepseek / openai / 等等都用这个
    if (resolved.protocol === 'openai' || !resolved.protocol) {
      const url = `${resolved.baseUrl.replace(/\/$/, '')}/chat/completions`;
      const response = await fetch(url, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${resolved.apiKey}`,
        },
        body: JSON.stringify({
          model: resolved.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.1,   // 几乎确定性,跑分类而已
          max_tokens: Math.max(200, candidates.length * 2),
        }),
      });
      clearTimeout(timer);
      const text = await response.text();
      if (!response.ok) {
        return { ok: false, error: `帮工返回 ${response.status}: ${text.slice(0, 200)}`, rawResponse: text };
      }
      let data: any;
      try { data = JSON.parse(text); } catch { return { ok: false, error: '帮工返回不是 JSON', rawResponse: text }; }
      const content: string = data?.choices?.[0]?.message?.content || '';
      // 从回复里抽 JSON 数组
      const titleLineNos = extractJsonNumberArray(content);
      return {
        ok: true,
        titleLineNos,
        rawResponse: content,
        usage: data?.usage ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        } : undefined,
      };
    }
    // Gemini 协议 — 暂用简化版,实际项目里可能走 generateContent
    clearTimeout(timer);
    return { ok: false, error: `Gemini 协议暂未实现,请用 OpenAI 兼容协议(DeepSeek/MiniMax/OpenAI 等)` };
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      return { ok: false, error: `帮工调用超时(${cfg.timeoutMs}ms)` };
    }
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * 从 LLM 文本回包里提取数字数组
 *   支持: [1, 2, 3] / ```json\n[1,2,3]\n``` / 文字包裹等
 */
function extractJsonNumberArray(text: string): number[] | undefined {
  if (!text) return undefined;
  // 抓 ```json ... ``` 块优先
  const fence = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  const target = fence ? fence[1] : text;
  // 直接是 [1, 2, 3]
  const directMatch = target.match(/\[[\s\S]*?\]/);
  if (!directMatch) return undefined;
  try {
    const arr = JSON.parse(directMatch[0]);
    if (Array.isArray(arr)) {
      return arr.filter((x: any) => typeof x === 'number' && Number.isFinite(x));
    }
  } catch {}
  return undefined;
}
