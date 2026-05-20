/**
 * SullyOS Instant Push — Cloudflare Worker entry.
 *
 * Phase 2 Round 2 (这次):
 *  - 升 @rei-standard/amsg-instant 到 ^0.8.0-next.0
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
import {
  buildContentPush,
  buildToolRequestPush,
  MESSAGE_TYPE,
  PUSH_SOURCE,
} from '@rei-standard/amsg-shared';

import { classifyLLMOutput } from './classifier';

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

const cfWorker = createCloudflareWorker((env: Env) => {
  const blobStore = env.DB
    ? {
        adapter: createD1BlobStore(env.DB, { table: 'amsg_transient_blobs' }),
        // 用默认 2600 B / 60 s; 见 amsg-instant README §BlobStore.
      }
    : undefined;

  return {
    vapid: {
      email: env.VAPID_EMAIL || 'mailto:noreply@example.com',
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    },
    clientToken: env.AMSG_CLIENT_TOKEN,
    blobStore,
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
 * 双导出: fetch + scheduled. scheduled 只在 wrangler.toml 配 cron + DB binding 时
 * 被 CF 调度; 没绑 D1 时是 no-op, 不会跑.
 */
export default {
  fetch: cfWorker.fetch,
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
 * @param ctx 见 amsg-instant SessionContext: { sessionId, messages, llmOutputText,
 *            iteration, metadata, contactName, avatarUrl, llmResponse, ... }
 */
async function onLLMOutput(ctx: any) {
  const text: string = String(ctx.llmOutputText ?? '');
  const sessionId: string = ctx.sessionId;
  const iteration: number = Number(ctx.iteration ?? 0);
  const contactName: string = ctx.contactName ?? '';
  const avatarUrl: string | null = ctx.avatarUrl ?? null;
  // metadata 透传: 客户端 sendInstantPush 时塞了 charId; SW 路由要它分发到具体角色
  const callerMetadata = (ctx.metadata && typeof ctx.metadata === 'object') ? ctx.metadata : {};

  const result = classifyLLMOutput(text);
  const messageId = `msg_${sessionId}_${iteration}`;
  const baseCommon = {
    messageType: MESSAGE_TYPE.INSTANT,
    source: PUSH_SOURCE.INSTANT,
    messageId,
    sessionId,
    contactName,
    avatarUrl,
  };

  // notification.title 永远塞 — amsg-sw createNotificationFromPayload 没 title 时
  // 会 fallback 到字面字符串 "New notification", 体验差. 用 `来自 X` 跟客户端
  // saveContentToInbox 的 charName 一致. trim 兜底 contactName 全空白的边界情况.
  const trimmedContactName = (contactName || '').trim();
  const notificationBase = { title: `来自 ${trimmedContactName || '主动消息'}` };

  if (result.kind === 'tool-request') {
    // notification.body 条件塞: sanitize 真改了字符才塞, 没改则 amsg-sw fallback
    // 到 payload.message — payload size 不翻倍. sanitize 把 body 净化成空串时
    // (e.g. 只有 <think>) 用 zero-width-space 占位, 防 amsg-sw 的 `||` 短路
    // 把 raw payload.message 漏到 OS banner.
    const notification = result.sanitizedPrefix !== result.prefix
      ? { ...notificationBase, body: result.sanitizedPrefix || '​' }
      : notificationBase;
    const pushPayload = {
      ...buildToolRequestPush({
        ...baseCommon,
        toolCalls: result.toolCalls,
        // prefix 进 message 字段; SW tool_request 路由会把它写 inbox 让前置 narration 立刻显示.
        // 可能为空串 (LLM 没说任何前置文本就直接吐数据标签), 那种情况下 SW 跳过 inbox 写入.
        message: result.prefix,
        metadata: {
          ...callerMetadata,
          // 客户端续跑时把 iteration + 1 重新发给 worker (见 amsg-instant /continue 契约).
          iteration,
        },
      }),
      notification,
      // 0.8.0-next.2 splitPattern 默认 ON (按句切); 显式 null 保单 push,
      // SullyOS 客户端 applyAssistantPostProcessing Step 13 在端上分句.
      splitPattern: null,
    };
    warnIfPayloadLarge(pushPayload);
    return { decision: 'tool-request' as const, pushPayload };
  }

  // result.kind === 'finish' — 同 tool-request 分支的 sanitize 空串 → ZWSP 占位逻辑
  const notification = result.sanitizedBody !== result.cleanedText
    ? { ...notificationBase, body: result.sanitizedBody || '​' }
    : notificationBase;
  const pushPayload = {
    ...buildContentPush({
      ...baseCommon,
      message: result.cleanedText,
      // 1 索引 + 1 总数: SullyOS 客户端不依赖 worker 端分句, 而是由 applyAssistantPostProcessing
      // 在 client 端按用户 splitPattern 分句保存到 DB. 这里送整段文本, 单 ContentPush.
      messageIndex: 1,
      totalMessages: 1,
      metadata: {
        ...callerMetadata,
        // directives = [] 时客户端 applyAssistantPostProcessing 仍走原文扫描路径 (兼容 worker
        // 没分类成功 / 老 SW 落到本路径的场景). 非空时只重放, 不再扫.
        directives: result.directives,
        iteration,
      },
    }),
    notification,
    splitPattern: null,
  };
  warnIfPayloadLarge(pushPayload);
  return { decision: 'finish' as const, pushPayload };
}

/**
 * 早警告水位 — amsg-instant next.2 默认 maxInlineBytes=2600, 超了就 500
 * PAYLOAD_TOO_LARGE. 2300 留 ~300B margin 给 amsg-instant wrapping 字段
 * (kind/messageKind/_blob envelope 等). 只 log 不阻塞, 真撞限的话 amsg
 * 自己会兜底.
 */
function warnIfPayloadLarge(payload: unknown): void {
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
    if (bytes > 2300) {
      console.warn('[instant-push] payload close to limit', { bytes });
    }
  } catch {
    // JSON.stringify 抛 (循环引用?) 时不阻塞主流程
  }
}
