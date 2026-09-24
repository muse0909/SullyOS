import type { ActiveMsg2InboxMessage } from '../types';
import { flushInboxToChat } from './activeMsgRuntime';
import { ActiveMsgStore } from './activeMsgStore';
// 麦麦 2026-09-23 22:50：诊断日志 — 节点 6 wakeup-payload-parsed
import { amsgDiag } from './amsgDiag';

const RECEIVED_IDS_KEY = 'amsg2_native_received_ids_v2';

const readReceivedIds = (): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECEIVED_IDS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
};

const rememberReceivedId = (messageId: string): void => {
  const next = [messageId, ...readReceivedIds().filter((id) => id !== messageId)].slice(0, 100);
  localStorage.setItem(RECEIVED_IDS_KEY, JSON.stringify(next));
};

export const parseNativeAmsgPayload = (raw: unknown): Record<string, any> | null => {
  if (raw && typeof raw === 'object') return raw as Record<string, any>;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, any> : null;
  } catch {
    return null;
  }
};

/** 把 UnifiedPush 收到的标准 AMSG payload 送进 master 现有的 inbox 管线。 */
export const ingestNativeAmsgPayload = async (
  raw: unknown,
  previewOverride?: string,
): Promise<{ charId: string; messageId: string } | null> => {
  const payload = parseNativeAmsgPayload(raw);
  const charId = payload?.metadata?.charId;
  if (!payload || typeof charId !== 'string' || !charId) {
    // 麦麦 2026-09-23 22:50：诊断日志 — payload 缺 charId 早退
    amsgDiag({
      stage: 'wakeup-payload-parsed',
      ok: false,
      error: 'payload 缺 metadata.charId 或解析失败',
    });
    return null;
  }

  const messageId = String(payload.messageId || `${charId}-${Date.now()}`);
  if (readReceivedIds().includes(messageId)) {
    // 麦麦 2026-09-23 22:50：诊断日志 — 重复 messageId 早退
    amsgDiag({
      stage: 'wakeup-payload-parsed',
      msgId: messageId,
      charId,
      ok: false,
      error: 'messageId 已在 receivedIds 中（重复推送）',
    });
    return { charId, messageId };
  }

  const parsedSentAt = payload.timestamp ? new Date(payload.timestamp).getTime() : NaN;
  const body = String(payload.message || '').trim();
  const inbox: ActiveMsg2InboxMessage = {
    messageId,
    charId,
    charName: String(payload.contactName || payload.metadata?.charName || '主动消息'),
    body,
    previewBody: String(previewOverride || payload.previewBody || body).trim(),
    avatarUrl: payload.avatarUrl,
    source: payload.source,
    messageType: payload.messageType,
    messageSubtype: payload.messageSubtype,
    taskId: payload.taskId ?? null,
    taskUuid: payload.taskUuid ?? null,
    recurrenceType: payload.recurrenceType ?? null,
    occurrenceMs: payload.occurrenceMs ?? null,
    metadata: {
      ...(payload.metadata || {}),
      sessionId: payload.sessionId,
      messageIndex: payload.messageIndex,
      totalMessages: payload.totalMessages,
    },
    sentAt: Number.isFinite(parsedSentAt) ? parsedSentAt : Date.now(),
    receivedAt: Date.now(),
  };

  // 麦麦 2026-09-23 22:50：诊断日志 — payload 解析成功，msgId/taskUuid 拿到
  amsgDiag({
    stage: 'wakeup-payload-parsed',
    msgId: messageId,
    taskId: payload.taskUuid ?? undefined,
    charId,
    ok: true,
  });

  await ActiveMsgStore.saveInboxMessage(inbox);
  rememberReceivedId(messageId);
  await flushInboxToChat('原生收件箱');
  return { charId, messageId };
};
