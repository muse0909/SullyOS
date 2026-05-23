/**
 * SullyOS Instant Push — Cloudflare Worker entry.
 *
 * Phase 2 Round 2 (这次):
 *  - 升 @rei-standard/amsg-instant 到 ^0.8.0-next.3
 *  - 配置 onLLMOutput hook: SullyOS 业务标签分类器 (见 ./classifier.ts)
 *  - 数据标签 → tool-request push (客户端跑工具, POST /continue 续跑)
 *  - 副作用标签 → finish + metadata.directives (客户端重放)
 *  - reasoning_content 由 amsg-instant 自动 emit ReasoningPush, 我们不碰
 *  - 可选 D1 BlobStore: 部署时给 worker 加 `DB` binding 即启用, 否则 push 超 2.6KB 会 500
 *
 * 入口仍是 createCloudflareWorker 工厂, env 在请求级注入 (secrets 在 wrangler.toml 外配置).
 */

import { createCloudflareWorker } from '@rei-standard/amsg-instant/adapters/cloudflare';
import { createD1BlobStore } from '@rei-standard/amsg-instant/blob/d1';
import { sendPushWithMaybeBlob } from '@rei-standard/amsg-instant';
import {
  buildContentPush,
  buildToolRequestPush,
  MESSAGE_TYPE,
  PUSH_SOURCE,
} from '@rei-standard/amsg-shared';

import { classifyLLMOutput } from './classifier';
import { sanitizeIntoSegments, type Segment } from '../../../utils/sanitize';

export interface Env {
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_EMAIL?: string;
  AMSG_CLIENT_TOKEN?: string;
  /**
   * 可选 D1 binding. 配了就启用 BlobStore — agentic loop + reasoning 场景下
   * push payload p99 容易超 2.6 KB 安全线, 没 BlobStore 会 500 PAYLOAD_TOO_LARGE.
   * 表结构见 worker/instant-push/schema.sql.
   */
  DB?: D1Database;
}

type D1Database = {
  prepare(query: string): {
    bind(...args: unknown[]): {
      run(): Promise<unknown>;
      first<T = unknown>(): Promise<T | null>;
    };
  };
};

function createBlobStore(env: Env) {
  return env.DB
    ? {
        adapter: createD1BlobStore(env.DB, { table: 'amsg_transient_blobs' }),
        // 用默认 2600 B / 60 s; 见 amsg-instant README §BlobStore.
      }
    : undefined;
}

const cfWorker = createCloudflareWorker((env: Env) => {
  return {
    vapid: {
      email: env.VAPID_EMAIL || 'mailto:noreply@example.com',
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    },
    clientToken: env.AMSG_CLIENT_TOKEN,
    blobStore: createBlobStore(env),
    maxLoopIterations: 10,
    onLLMOutput,
    onEvent: (e: { type: string; [k: string]: unknown }) => {
      // CF Workers logging — 只在异常分支打详细 log, 减少正常路径 stdout 噪音
      if (
        e.type === 'hook_threw'
        || e.type === 'loop_exceeded'
        || e.type === 'llm_call_failed'
        || e.type === 'blob_put_failed'
        || e.type === 'payload_too_large'
      ) {
        console.error('[instant-push]', e);
      }
    },
  };
});

/**
 * 副 API 情绪评估 (worker 端). 框架的 onLLMOutput hook 故意不暴露 apiKey、也不允许自己发 LLM/push
 * (见 amsg-instant SessionContext 文档), 所以情绪评估的第二次 LLM 调用 + emotion_update 推送
 * 在框架外、这层包装里做: 客户端把副 API 凭据 + 拼好的 eval prompt 放在请求体 emotionEval 字段,
 * 主回复跑完后 (cfWorker.fetch 返回后) 用 ctx.waitUntil 跑 eval, 把原始结果作为 emotion_update
 * push 推回. 客户端 SW 路由进 inbox, flush 时 applyEmotionEvalRaw 落 buff + 广播 innerState.
 *
 * 失败全吞 (情绪评估失败不该影响主回复); emotion_update 不带 notification, SW 静默入 inbox.
 */
async function runEmotionEval(body: any, env: Env, requestUrl?: string): Promise<void> {
  const ee = body?.emotionEval;
  const sub = body?.pushSubscription;
  if (!ee?.prompt || !ee?.api?.baseUrl || !ee?.api?.apiKey || !ee?.api?.model) return;
  if (!sub || typeof sub.endpoint !== 'string') return;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;

  const charId = (body?.metadata && typeof body.metadata === 'object') ? body.metadata.charId : '';
  // 情绪评估 = 单条 user 消息, 与本地 buildEmotionEvalPrompt 输出**逐字对齐**. 客户端把 prompt 里
  // 两段大文本 (system prompt、对话历史) 留成占位符, 这里用本次请求已有的 messages 还原后替换回原位:
  //   - body.messages[0] (role=system) = 本地的 mainSystemPrompt
  //   - body.messages[1..]             = 本地的 cleanedApiMessages → 同格式拼成 recentLines
  // 这样上下文不必在请求体里重复发 (keepalive 不被降级), 评估质量/顺序与本地完全一致.
  const priorMessages = Array.isArray(body?.messages) ? body.messages : [];
  const contactName = body?.contactName || '角色';
  const flattenContent = (content: any): string => {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((p: any) => (p?.type === 'text' ? (p.text || '') : (p?.type === 'image_url' ? '[图片]' : '')))
        .filter(Boolean)
        .join(' ');
    }
    return '';
  };
  let systemPromptText = '';
  let conversation = priorMessages;
  if (priorMessages.length > 0 && priorMessages[0]?.role === 'system') {
    systemPromptText = flattenContent(priorMessages[0].content);
    conversation = priorMessages.slice(1);
  }
  // 与本地 recentLines 完全同格式: `[用户]: ...` / `[角色名]: ...` / `[系统]: ...`, 用 \n 连接.
  const recentLines = conversation
    .map((m: any) => {
      const role = m.role === 'user' ? '用户' : (m.role === 'assistant' ? contactName : '系统');
      return `[${role}]: ${flattenContent(m.content)}`;
    })
    .join('\n');
  // 用函数式 replacer: 避免 systemPrompt / 对话里出现 $&、$1 等被 String.replace 当成替换模式解析.
  const evalContent = String(ee.prompt)
    .replace('__EMOTION_EVAL_SYSTEM_PROMPT__', () => systemPromptText)
    .replace('__EMOTION_EVAL_HISTORY__', () => recentLines);
  const evalMessages = [{ role: 'user', content: evalContent }];
  try {
    const baseUrl = String(ee.api.baseUrl).replace(/\/+$/, '');
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ee.api.apiKey || 'sk-none'}`,
      },
      body: JSON.stringify({
        model: ee.api.model,
        messages: evalMessages,
        temperature: 0.85,
        stream: false,
      }),
    });
    let raw = '';
    if (res.ok) {
      const data: any = await res.json();
      raw = data?.choices?.[0]?.message?.content || '';
    } else {
      console.error('[emotion-eval] LLM call failed', res.status);
    }

    // 无论成功 / 失败 / 空结果都推一条 emotion_update (emotionRaw 可能为空字符串):
    // 客户端据此熄灭 "情绪分析中" 徽章, 否则只能等本地安全超时, 体验上像卡死.
    const pushObj = {
      messageKind: 'emotion_update',
      messageType: MESSAGE_TYPE.INSTANT,
      source: PUSH_SOURCE.INSTANT,
      sessionId: body?.sessionId || '',
      contactName: body?.contactName || '',
      message: '',
      messageId: `msg_${body?.sessionId || Date.now()}_emotion`,
      timestamp: Date.now(),
      metadata: { charId, emotionRaw: raw },
    };

    // Reuse amsg's BlobStore path so large emotionRaw payloads do not exceed Web Push limits.
    await sendPushWithMaybeBlob(pushObj, { pushSubscription: sub }, {
      vapid: {
        email: env.VAPID_EMAIL || 'mailto:noreply@example.com',
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
      },
      blobStore: createBlobStore(env),
      requestUrl,
      onEvent: (e: { type: string; [k: string]: unknown }) => {
        if (e.type === 'payload_too_large' || e.type === 'blob_put_failed' || e.type === 'blob_orphaned') {
          console.error('[emotion-eval] push delivery event', e);
        }
      },
    } as any, body?.sessionId || '');
  } catch (e) {
    console.error('[emotion-eval] failed', e);
  }
}

/**
 * 双导出: fetch + scheduled. scheduled 只在 wrangler.toml 配 cron + DB binding 时
 * 被 CF 调度; 没绑 D1 时是 no-op, 不会跑.
 *
 * fetch 在框架处理之外包了一层: 先把请求体克隆出来 (拿 emotionEval / pushSubscription),
 * 让框架跑完主回复 + 推送, 再在 waitUntil 里跑副 API 情绪评估 + 推 emotion_update.
 */
export default {
  fetch: async (request: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) => {
    let body: any = null;
    try {
      body = await request.clone().json();
    } catch {
      body = null; // 非 JSON / 解析失败: 不影响主路径
    }
    // 情绪评估不依赖主回复内容 (用 body.messages = 与主回复同一批消息, 跟本地一样不含新回复),
    // 所以与主回复**并行**跑, 而不是 await cfWorker.fetch (流式输出 + 推送 + 收尾可能拖 ~30s)
    // 完成后才启动 —— 砍掉情绪评估的启动延迟, 让 buff / "情绪分析中" 徽章尽快结算.
    if (body?.emotionEval) {
      ctx.waitUntil(runEmotionEval(body, env, request.url));
    }
    return await (cfWorker as any).fetch(request, env, ctx);
  },
  async scheduled(_event: unknown, env: Env) {
    if (!env.DB) return;
    try {
      await env.DB.prepare('DELETE FROM amsg_transient_blobs WHERE expires_at < ?')
        .bind(Date.now())
        .run();
    } catch (e) {
      console.error('[instant-push] blob sweeper failed', e);
    }
  },
};

/**
 * onLLMOutput hook — 每轮 LLM 输出后调一次, 返 decision payload.
 *
 * Thin shim: 从 amsg-instant SessionContext 读字段 + normalize, 再委托给纯函数
 * buildPushDecision. 业务逻辑 + 边界处理都在 buildPushDecision 里 (方便单测).
 *
 * @param ctx 见 amsg-instant SessionContext: { sessionId, messages, llmOutputText,
 *            iteration, metadata, contactName, avatarUrl, llmResponse, ... }
 */
async function onLLMOutput(ctx: any) {
  return buildPushDecision({
    llmOutputText: String(ctx.llmOutputText ?? ''),
    sessionId: ctx.sessionId,
    iteration: Number(ctx.iteration ?? 0),
    contactName: ctx.contactName ?? '',
    avatarUrl: ctx.avatarUrl ?? null,
    // metadata 透传: 客户端 sendInstantPush 时塞了 charId; SW 路由要它分发到具体角色
    callerMetadata: (ctx.metadata && typeof ctx.metadata === 'object') ? ctx.metadata : {},
  });
}

// ─── Pure logic: 抽出来给单测 ──────────────────────────────────────────────

export interface PushDecisionInput {
  llmOutputText: string;
  sessionId: string;
  iteration: number;
  contactName: string;
  avatarUrl: string | null;
  callerMetadata: Record<string, unknown>;
}

export interface PushDecisionDeps {
  /** 自定义 size warn 回调; 默认走 console.warn. 测试用来 spy. */
  onSizeWarn?: (bytes: number) => void;
}

export type PushDecision =
  | { decision: 'tool-request'; pushPayloads: unknown[] }
  | { decision: 'finish'; pushPayloads: unknown[] }
  | { decision: 'skip-push' };

/**
 * 纯函数: 给 normalize 过的 ctx 字段, 出 { decision, pushPayloads }.
 *
 * amsg-instant 0.8.0-next.4 起 hook 返回 pushPayloads 数组, lib 不做 split, hook
 * 自己负责把内容切成 N 个独立 push. 我们用 sanitizeIntoSegments 把 LLM 输出
 * 切成 segments (按换行 + CJK 空格切, 跟客户端 chatParser.chunkText 一致),
 * 每个 segment 一条 push, banner 显示 sanitized 版本, message 保留 raw 让客户端
 * Step 9/5/8 渲染.
 *
 * 空输入 / sanitize 全 strip 完没剩内容时返 skip-push (没东西可发, lib 跳过这一轮).
 *
 * Tool-request: classifier 提取的 prefix 切 segments 当 content push, 再 append
 * 一条 tool_request push 在末尾 (toolCalls 在那条上). decision 跟 push 内容
 * messageKind 分布解耦, lib 不检查.
 *
 * Directives (副作用标签): finish 路径只在**最后一条** push 的 metadata 上挂,
 * 防止客户端 N 条 inbox entry 都跑一次 replay (applyAssistantPostProcessing
 * 这边也加了 messageIndex==totalMessages 守卫双保险).
 */
export function buildPushDecision(
  input: PushDecisionInput,
  deps?: PushDecisionDeps,
): PushDecision {
  const { llmOutputText, sessionId, iteration, contactName, avatarUrl, callerMetadata } = input;

  const result = classifyLLMOutput(llmOutputText);
  const baseCommon = {
    messageType: MESSAGE_TYPE.INSTANT,
    source: PUSH_SOURCE.INSTANT,
    sessionId,
    contactName,
    avatarUrl,
  };

  const trimmedContactName = (contactName || '').trim();
  const notificationTitle = `来自 ${trimmedContactName || '主动消息'}`;

  if (result.kind === 'tool-request') {
    // 把 prefix narration 切 segments. classifier 已经剥 DATA tag, prefix 里只
    // 剩 narration 文字 (可能含 SEND_EMOJI / [html] 业务标签).
    const narrationSegments = sanitizeIntoSegments(result.prefix);
    const narrationPushes = narrationSegments.map((seg, i) =>
      buildSegmentPush({ seg, baseCommon, notificationTitle, callerMetadata, iteration, chunkIdx: i, sessionId }),
    );
    // tool_request push 在末尾, message 空 (narration 已经独立成 push), toolCalls 在
    // 这条上, 不带 notification → SW tool_request 分轨不弹 banner.
    const toolPush = {
      ...buildToolRequestPush({
        ...baseCommon,
        messageId: `msg_${sessionId}_${iteration}_toolreq`,
        message: '',
        toolCalls: result.toolCalls,
        metadata: {
          ...callerMetadata,
          iteration,
        },
      }),
    };
    const pushPayloads = [...narrationPushes, toolPush];
    pushPayloads.forEach((p) => warnIfPayloadLarge(p, deps?.onSizeWarn));
    return { decision: 'tool-request', pushPayloads };
  }

  // finish
  const segments = sanitizeIntoSegments(result.cleanedText);
  if (segments.length === 0) {
    // 整段没用户可见正文 (e.g. LLM 只吐 [[DIARY_START]]...[[DIARY_END]] / [[XHS_POST: ...]] /
    // [[ACTION:POKE]] 无 narration) 时:
    //   - 没 directives → 真的无事可做, skip-push
    //   - 有 directives → 发一条 directive-only push: message:'', 不带 notification (SW 不弹 banner),
    //     directives 挂 metadata. 客户端 applyAssistantPostProcessing 看到 directives 非空照常 replay,
    //     副作用 (写日记 / XHS_POST / POKE) 在重放中自己产 system message (e.g. `📔 X写了日记「…」`),
    //     用户在 chat 里看得到反馈, 不需要再弹 banner.
    if (result.directives.length === 0) {
      return { decision: 'skip-push' };
    }
    const directiveOnlyPush = buildDirectiveOnlyPush({
      baseCommon,
      callerMetadata,
      iteration,
      sessionId,
      directives: result.directives,
    });
    warnIfPayloadLarge(directiveOnlyPush, deps?.onSizeWarn);
    return { decision: 'finish', pushPayloads: [directiveOnlyPush] };
  }
  const lastIdx = segments.length - 1;
  const pushPayloads = segments.map((seg, i) =>
    buildSegmentPush({
      seg,
      baseCommon,
      notificationTitle,
      callerMetadata,
      iteration,
      chunkIdx: i,
      sessionId,
      // directives 只挂在最后一条 push 上, 客户端按 messageIndex==totalMessages 守卫
      directives: i === lastIdx ? result.directives : undefined,
    }),
  );
  pushPayloads.forEach((p) => warnIfPayloadLarge(p, deps?.onSizeWarn));
  return { decision: 'finish', pushPayloads };
}

/**
 * directive-only push — 当 LLM 输出整段全是副作用标签 (无 narration) 时用.
 *
 * 跟 buildSegmentPush 的区别:
 *  - message: ''        (客户端 applyAssistantPostProcessing 看 rawAiContent='' + replayedTagPrefix
 *                        重建副作用标签, 不会产生气泡: chunking 0 chunks → 0 bubble)
 *  - 不带 notification  (SW 不弹 banner — 副作用 handler 自己产 system message 给用户看)
 *  - chunkIdx 用 'directive' 占位字符串避免跟 segment 0 撞 messageId
 *
 * amsg-shared buildContentPush 允许 message:'', 只对 ReasoningPush 要求 non-empty (已查 next.5 schema).
 */
function buildDirectiveOnlyPush(args: {
  baseCommon: {
    messageType: typeof MESSAGE_TYPE.INSTANT;
    source: typeof PUSH_SOURCE.INSTANT;
    sessionId: string;
    contactName: string;
    avatarUrl: string | null;
  };
  callerMetadata: Record<string, unknown>;
  iteration: number;
  sessionId: string;
  directives: unknown[];
}): unknown {
  const { baseCommon, callerMetadata, iteration, sessionId, directives } = args;
  return buildContentPush({
    ...baseCommon,
    messageId: `msg_${sessionId}_${iteration}_directive`,
    message: '',
    metadata: {
      ...callerMetadata,
      iteration,
      directives,
    },
  });
}

/**
 * 单 segment → 单 ContentPush. messageId 显式给唯一值 ( amsg-shared typedef
 * 要求, 不能 undefined ). next.4 lib runtime 看到 hook 已设 messageId 就不动,
 * 只对未设的自动补 _chunk_${i} 后缀.
 */
function buildSegmentPush(args: {
  seg: Segment;
  baseCommon: {
    messageType: typeof MESSAGE_TYPE.INSTANT;
    source: typeof PUSH_SOURCE.INSTANT;
    sessionId: string;
    contactName: string;
    avatarUrl: string | null;
  };
  notificationTitle: string;
  callerMetadata: Record<string, unknown>;
  iteration: number;
  chunkIdx: number;
  sessionId: string;
  directives?: unknown[];
}): unknown {
  const { seg, baseCommon, notificationTitle, callerMetadata, iteration, chunkIdx, sessionId, directives } = args;
  // notification.body 跟 message 显示文本可以不一样 (SEND_EMOJI 在 banner 上是
  // [表情：x], 在 message 里是 [[SEND_EMOJI: x]] 让客户端 Step 9 渲染 sticker).
  // 即使 sanitized === raw 也照样塞 — next.4 lib 不再 clone notification 跨 chunk,
  // 每条独立, 不会重复占 size.
  return {
    ...buildContentPush({
      ...baseCommon,
      messageId: `msg_${sessionId}_${iteration}_chunk_${chunkIdx}`,
      message: seg.raw,
      metadata: {
        ...callerMetadata,
        iteration,
        ...(directives !== undefined ? { directives } : {}),
      },
    }),
    notification: { title: notificationTitle, body: seg.sanitized },
  };
}

/**
 * 早警告水位 — amsg-instant next.2 默认 maxInlineBytes=2600, 超了就 500
 * PAYLOAD_TOO_LARGE. 2300 留 ~300B margin 给 amsg-instant wrapping 字段
 * (kind/messageKind/_blob envelope 等). 默认 console.warn, 测试可注入
 * onSizeWarn 抓 bytes 参数.
 */
function warnIfPayloadLarge(
  payload: unknown,
  onSizeWarn?: (bytes: number) => void,
): void {
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
    if (bytes > 2300) {
      if (onSizeWarn) {
        onSizeWarn(bytes);
      } else {
        console.warn('[instant-push] payload close to limit', { bytes });
      }
    }
  } catch {
    // JSON.stringify 抛 (循环引用?) 时不阻塞主流程
  }
}
