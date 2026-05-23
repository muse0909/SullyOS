/**
 * instantToolRunner — Phase 2 Round 2 客户端 tool runner
 *
 * 消费 SW 写到 `pending_tool_calls` store 的 ToolRequestPush, 用 agenticTools 跑本地工具,
 * 把 OpenAI-shape tool result 拼好 POST /continue 让 worker 续跑下一轮 LLM. final push
 * 由 SW 像首轮一样写 inbox, ActiveMsgRuntime.flushInboxToChat 跑 applyAssistantPostProcessing.
 *
 * 触发时机:
 *   - ActiveMsgRuntime.init 启动时排空一次 (兜底冷启动 / swipe-kill 重启)
 *   - SW 收到 tool_request push + 当前 window visible 时 postMessage('instant-tool-request'),
 *     ActiveMsgRuntime 收到后立刻调用 runPendingToolCalls()
 *
 * 失败语义:
 *   - dispatch 抛错 (DB / 网络) → 这条 pending 已被 atomic claim 走, 重试需要用户重新触发推送
 *   - POST /continue 失败 → 同上; 留 console.error, 后续 phase 加 dead-letter
 *   - 走"先 ack 后处理"是为了不让重投 push 把 toolCalls 跑两遍 (LLM 费用 + UI 重复)
 */

import { ActiveMsgStore } from './activeMsgStore';
import { DB } from './db';
import { dispatchAgenticTool, type AgenticToolCtx } from './agenticTools';
import { loadInstantConfig, isInstantConfigReady, getOrCreateInstantSubscription, byteLengthOf } from './instantPushClient';
import { pushXhsCaches, pushLastXhsNotesRef } from './activeMsgRuntime';
import type { APIConfig, RealtimeConfig, UserProfile, InstantPushPendingToolCall } from '../types';

type InstantToolStatusPhase = 'running' | 'continuing' | 'done' | 'failed';

function getToolStatusLabel(toolCalls: InstantPushPendingToolCall['toolCalls']): string {
  const names = toolCalls.map((call) => call.function.name);
  if (names.some((name) => name.startsWith('xhs_'))) return '读取小红书';
  if (names.some((name) => name === 'notion_read_diary' || name === 'read_note')) return '读取 Notion';
  if (names.some((name) => name === 'feishu_read_diary')) return '读取飞书';
  if (names.some((name) => name === 'web_search')) return '搜索网页';
  if (names.some((name) => name === 'recall')) return '读取记忆';
  return '调用工具';
}

function emitToolStatus(
  charId: string,
  phase: InstantToolStatusPhase,
  text: string,
  sessionId?: string,
): void {
  const detail = { charId, phase, text, sessionId, updatedAt: Date.now() };
  try {
    localStorage.setItem(`instant_tool_status_${charId}`, JSON.stringify(detail));
  } catch { /* ignore */ }
  try {
    window.dispatchEvent(new CustomEvent('instant-tool-status', {
      detail,
    }));
  } catch { /* ignore */ }
}

/** 跑一轮 ToolRequest → POST /continue. 失败时返回 false (上层决定要不要 toast). */
async function runOnePendingToolCall(item: InstantPushPendingToolCall): Promise<boolean> {
  const toolLabel = getToolStatusLabel(item.toolCalls);
  emitToolStatus(
    item.charId,
    'running',
    `正在${toolLabel}，请先停留在此页，完成后会自动继续回复。`,
    item.sessionId,
  );

  const session = await ActiveMsgStore.getOutboundSession(item.sessionId);
  if (!session) {
    console.warn('[instant-tool-runner] outbound session not found, skipping', item.sessionId);
    emitToolStatus(item.charId, 'failed', `${toolLabel}中断了，请重新触发这次回复。`, item.sessionId);
    return false;
  }

  const characters = await DB.getAllCharacters();
  const char = characters.find((c) => c.id === item.charId);
  if (!char) {
    console.warn('[instant-tool-runner] character not found', item.charId);
    emitToolStatus(item.charId, 'failed', `${toolLabel}中断了，请重新触发这次回复。`, item.sessionId);
    return false;
  }

  const userProfile: UserProfile =
    (await DB.getUserProfile()) ?? { name: 'User', avatar: '', bio: '' };
  const realtimeConfig = loadRealtimeConfigFromLocalStorage();

  // tool runner 用的 ctx 跟 applyAssistantPostProcessing 本地 fetch 路径用的是同一个形状.
  //
  // xhsCaches / lastXhsNotesRef 直接复用 activeMsgRuntime 的模块级单例 — 不再每次新建空 Map.
  // 这样 round 1 在这里 runXhsBrowse 填充的 notes + xsecToken 能被 round 2 (worker 发回 push
  // 后 applyAssistantPostProcessing 处理 [[XHS_SHARE: 序号]] / [[XHS_COMMENT: ...]]) 读到.
  //
  // 生命周期 = 主进程打开期间. 刷页面 / 关浏览器清空, 跟本地 fetch 路径 useChatAI useRef 等价.
  const ctx: AgenticToolCtx = {
    char,
    userProfile,
    realtimeConfig,
    xhsCaches: pushXhsCaches,
    lastXhsNotesRef: pushLastXhsNotesRef,
    onProgress: (_channel, text) => {
      console.log('[instant-tool-runner:progress]', text);
      emitToolStatus(item.charId, 'running', `${text}，请先停留在此页。`, item.sessionId);
    },
  };

  // 1. 跑所有 tool, 串行 — agenticTools 内部多步 (XHS retry / DIARY fallback) 不能并发.
  const toolResults: Array<{ tool_call_id: string; role: 'tool'; content: string }> = [];
  for (const call of item.toolCalls) {
    let result: unknown;
    try {
      const args = JSON.parse(call.function.arguments || '{}');
      result = await dispatchAgenticTool(call.function.name, args, ctx);
    } catch (e) {
      console.error('[instant-tool-runner] tool failed', call.function.name, e);
      result = { ok: false, reason: 'tool_threw', message: (e as Error)?.message ?? String(e) };
    }
    toolResults.push({
      tool_call_id: call.id,
      role: 'tool',
      // OpenAI 兼容端点要求 tool result content 是字符串; agenticTools 返结构化 result, JSON 化.
      content: JSON.stringify(result),
    });
  }

  // 2. 拼下一轮 LLM 看到的 messages: outbound history + assistant tool_call message + tool results.
  //    这是 OpenAI tool-call 协议的标准形状; worker 拿到后会直接转发给 LLM.
  const assistantMsg = {
    role: 'assistant' as const,
    content: item.llmOutputText || '',
    tool_calls: item.toolCalls,
  };
  const nextMessages = [...session.messages, assistantMsg, ...toolResults];

  // 3. 找到 push subscription + worker 凭据.
  const cfg = loadInstantConfig();
  if (!isInstantConfigReady(cfg)) {
    console.warn('[instant-tool-runner] instant config not ready, cannot continue');
    emitToolStatus(item.charId, 'failed', `${toolLabel}完成了，但 Instant Push 配置不可用，没法继续回复。`, item.sessionId);
    return false;
  }
  const { sub } = await getOrCreateInstantSubscription();
  if (!sub) {
    console.warn('[instant-tool-runner] no push subscription, cannot continue');
    emitToolStatus(item.charId, 'failed', `${toolLabel}完成了，但推送订阅不可用，没法继续回复。`, item.sessionId);
    return false;
  }

  // 4. POST /continue. body 形状 = /instant + sessionId + iteration. apiCredentials 从
  //    outbound_session 取 (sendInstantPush 时记下的, 跨 round 用同一组).
  const apiConfig = loadApiConfigFromLocalStorage();
  const url = `${cfg.workerUrl.replace(/\/+$/, '')}/continue`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.clientToken) headers['X-Client-Token'] = cfg.clientToken;

  // iteration: SW 在 savePendingToolCall 时持久化了上一轮 worker hook 看到的 iteration
  // (从 push.metadata.iteration 透传). /continue 必须严格递增, worker 端 fail-fast 400 守.
  const nextIteration = (item.iteration ?? 0) + 1;

  // amsg-instant 0.6.0+ 强校验 avatarUrl: 仅接受 http(s), data: URI 直接 INVALID_PAYLOAD_FORMAT.
  // SullyOS 角色头像基本是 base64 存的, 直传会被包侧拒. 没有公网 URL 就干脆不传 — 通知端
  // 用 worker 自己的默认图标. 同 useChatAI.ts:693 的处理.
  const safeAvatarUrl = /^https?:\/\//i.test(char.avatar || '') ? char.avatar : undefined;

  const body = JSON.stringify({
    sessionId: item.sessionId,
    iteration: nextIteration,
    messages: nextMessages,
    pushSubscription: sub,
    apiUrl: session.apiCredentials.baseUrl || apiConfig.baseUrl,
    apiKey: session.apiCredentials.apiKey || apiConfig.apiKey,
    primaryModel: session.apiCredentials.model || apiConfig.model,
    contactName: char.name,
    avatarUrl: safeAvatarUrl,
    charId: item.charId,
    metadata: { charId: item.charId, charName: char.name },
    temperature: 0.8,
  });

  try {
    emitToolStatus(item.charId, 'continuing', `${toolLabel}完成了，正在让角色继续回复。`, item.sessionId);
    // keepalive 64KiB 上限按 UTF-8 字节算, 用 body.length (UTF-16 单元) 会让带
    // 中文 tool 结果 (小红书 / 飞书读日记) 的 /continue 在边界 case 误放行, 浏览器拒发,
    // fetch 抛 TypeError: Failed to fetch. byteLengthOf 跟 instantPushClient 守卫同一份.
    const res = await fetch(url, { method: 'POST', headers, body, keepalive: byteLengthOf(body) <= 60 * 1024 });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      console.error('[instant-tool-runner] /continue HTTP failed', res.status, text);
      emitToolStatus(item.charId, 'failed', `${toolLabel}完成了，但续写请求失败了。`, item.sessionId);
      return false;
    }
    let parsed: any;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* ignore */ }
    if (parsed && parsed.success === false) {
      console.error('[instant-tool-runner] /continue worker rejected', parsed.error);
      emitToolStatus(item.charId, 'failed', `${toolLabel}完成了，但 worker 拒绝了续写请求。`, item.sessionId);
      return false;
    }
    // status === 'loop_exceeded' 也是 HTTP 200 + success:true (见 amsg-instant 错误码表),
    // 我们不在这里弹错; SW 会单独收到 error push, ActiveMsgRuntime 处理.
    emitToolStatus(item.charId, 'done', `${toolLabel}完成了，正在等角色的回复推回来。`, item.sessionId);
    return true;
  } catch (e) {
    console.error('[instant-tool-runner] /continue fetch threw', e);
    emitToolStatus(item.charId, 'failed', `${toolLabel}完成了，但续写请求没有发出去。`, item.sessionId);
    return false;
  }
}

/** 排空 pending_tool_calls store; 调用前后都是原子, 失败的不重投 (见 module 顶 doc). */
export async function runPendingToolCalls(): Promise<{ processed: number; ok: number }> {
  const pending = await ActiveMsgStore.consumePendingToolCalls();
  let ok = 0;
  for (const item of pending) {
    const success = await runOnePendingToolCall(item);
    if (success) ok += 1;
  }
  if (pending.length > 0) {
    console.log(`[instant-tool-runner] processed ${pending.length} pending tool call(s), ${ok} ok`);
  }
  return { processed: pending.length, ok };
}

// ── private helpers ─────────────────────────────────────────────────────────

function loadApiConfigFromLocalStorage(): APIConfig {
  const fallback: APIConfig = { baseUrl: '', apiKey: '', model: '' };
  try {
    const raw = localStorage.getItem('os_api_config');
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      baseUrl: parsed.baseUrl || '',
      apiKey: parsed.apiKey || '',
      model: parsed.model || '',
      ...parsed,
    };
  } catch {
    return fallback;
  }
}

function loadRealtimeConfigFromLocalStorage(): RealtimeConfig | undefined {
  try {
    const raw = localStorage.getItem('os_realtime_config');
    if (!raw) return undefined;
    return JSON.parse(raw) as RealtimeConfig;
  } catch {
    return undefined;
  }
}

