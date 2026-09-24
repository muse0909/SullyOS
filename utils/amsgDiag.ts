/**
 * 主动消息 2.0 全链路诊断日志。
 *
 * 设计目标：把 schedule_next_wakeup token 解析 → Worker 写任务 → Android 收推送
 *          → payload 解析 → 写聊天记录 → UI 刷新 → 系统通知 的 11 个节点
 *          用同一份 taskId / messageId 串起来，能在 Settings 页直接看。
 *
 * 三写：console.info + localStorage 环形 buffer + devDebug 类目。
 *   - console：现场排障，logcat / 浏览器 console 都打得到
 *   - localStorage：跨刷新保留，暮色装机看不到 console 时也能看
 *   - devDebug 面板：「主动消息 2.0」勾选类别时，导出 / 复制跟着带走
 *
 * 独立 key `amsg_diag_log_v1`：不复用 instant_push_trace_log_v1，
 *   避免主动消息日志被主动消息即时通道的高频日志挤掉。
 *
 * Worker fire 时刻不单独定义 stage（amsg-server 闭源 SDK，客户端无法埋点）。
 *   用「任务提交成功 (stage 3) → Android 收推送 (stage 5)」时间差描述链路总耗时。
 *
 * 敏感字段：apiKey / masterKey / VAPID priv / endpoint 全文 / 消息内容 / 角色人设
 *   一律不写。endpoint 只截前 30 字。
 */

import { APP_VERSION, BUILD_LABEL } from './buildInfo';
import { appendDevDebugLog } from './devDebug';
import { isUnifiedPushPlatform, NativeAmsgUnifiedPush } from './unifiedPushPlugin';

const AMSG_DIAG_KEY = 'amsg_diag_log_v1';
const AMSG_DIAG_LIMIT = 200;

export type AmsgDiagStage =
  | 'wakeup-token-parsed'        // 1. useChatAI 解析 token
  | 'wakeup-write-task'          // 2. registerCharacterWakeup 入口/出口
  | 'wakeup-worker-ack'          // 3. scheduleCharacterTask 返回
  | 'wakeup-android-receive'     // 4. UnifiedPushService.onMessage
  | 'wakeup-push-received'       // 5. pushReceiver 派发 pushReceived
  | 'wakeup-payload-parsed'      // 6. ingestNativeAmsgPayload
  | 'wakeup-save-message'        // 7. flushInboxToChat 写消息
  | 'wakeup-event-dispatched'    // 8. dispatchEvent active-msg-received
  | 'wakeup-chat-ui'             // 9. setLastMsgTimestamp / reloadMessages
  | 'wakeup-system-notification' // 10. 弹系统通知
  | 'wakeup-failed'              // 任意节点失败通用
  | 'wakeup-dedup-hit'           // 麦麦 2026-09-24：远端已有同 charId+fireAt 未触发任务，去重命中
  | 'wakeup-cancelled-by-user-message' // 麦麦 2026-09-24：用户发消息触发自动取消
  | 'wakeup-final'               // 链终
  // 麦麦 2026-09-24 v2：调查后两次任务来源的临时节点
  | 'wakeup-trigger-start'       // triggerAI 入口：写 triggerId + callSite
  | 'wakeup-aicontent-snapshot'  // 每次 aiContent = data.choices[0].message.content 重赋值后写一次
  | 'wakeup-token-parse-skip'    // 60 秒同 (charId,fireAt,reason) 内存 ring 命中跳过时写
  | 'wakeup-dedup-skip-local';   // 麦麦 2026-09-24 v3：A 严格入口闸 — 同角色已有 source='character' pending 时拒绝新建

export interface AmsgDiagEntry {
  ts: string;
  stage: AmsgDiagStage;
  /** 推送 payload 里的 messageId（贯穿 4 → 10） */
  msgId?: string;
  /** Worker 端 taskUuid（贯穿 2 → 4 推断） */
  taskId?: string;
  /** 角色 ID。含角色身份但不含角色人设 / 消息内容 */
  charId?: string;
  /** schedule_next_wakeup 解析的 fireAt epoch ms（贯穿 1 → 3） */
  fireAt?: number;
  /** 角色 token 的 reason，截断 80 字 */
  reason?: string;
  /** Worker 端 source 字段（manual / character） */
  source?: 'manual' | 'character';
  ok: boolean;
  /** 失败原因，截断 120 字；不含 stack trace（devDebug 另算） */
  error?: string;
  /**
   * 麦麦 2026-09-24 v2：自由扩展字段（不破坏现有 reader）。
   * 仅用于排查周期内的临时诊断：triggerAI callSite、aiContent 来源 label、
   * 整段 token 原文、同次 triggerAI 第几次解析… 等。
   * 老 reader 读取时会忽略此字段；新 reader 可读但不强依赖。
   * 结构：Record<string, string | number | boolean | null>，值会被 JSON 化落盘。
   */
  extra?: Record<string, string | number | boolean | null>;
}

interface RawAmsgDiagInput extends Omit<AmsgDiagEntry, 'ts' | 'ok' | 'reason' | 'error' | 'msgId' | 'taskId' | 'charId' | 'fireAt' | 'source' | 'extra'> {
  msgId?: string;
  taskId?: string;
  charId?: string;
  fireAt?: number;
  reason?: string;
  source?: 'manual' | 'character';
  ok?: boolean;
  error?: string;
  extra?: Record<string, string | number | boolean | null>;
}

const truncate = (value: string | undefined, max: number): string | undefined => {
  if (!value) return value;
  return value.length > max ? value.slice(0, max) + '...' : value;
};

const redactEndpoint = (url: string | undefined): string | undefined => {
  if (!url) return url;
  return url.length > 30 ? url.slice(0, 30) + '...' : url;
};

const buildAmsgDiagEntry = (input: RawAmsgDiagInput): AmsgDiagEntry => {
  // extra 字段：自由扩展。值为字符串时照样按 truncate 走 80 字避免爆 localStorage；
  // 其余类型（number/boolean/null）原样落。key 数量限制 12 个以内防事故。
  let extra: Record<string, string | number | boolean | null> | undefined;
  if (input.extra && typeof input.extra === 'object') {
    const entries: Array<[string, string | number | boolean | null]> = [];
    let count = 0;
    for (const [k, v] of Object.entries(input.extra)) {
      if (count >= 12) break;
      if (v === undefined) continue;
      if (typeof v === 'string') {
        entries.push([k, truncate(v, 80) as string]);
      } else {
        entries.push([k, v]);
      }
      count++;
    }
    if (entries.length > 0) extra = Object.fromEntries(entries);
  }
  return {
    ts: new Date().toISOString(),
    stage: input.stage,
    msgId: input.msgId,
    taskId: input.taskId,
    charId: input.charId,
    fireAt: input.fireAt,
    reason: truncate(input.reason, 80),
    source: input.source,
    ok: input.ok ?? true,
    error: truncate(input.error, 120),
    extra,
  };
};

/** 追加一条主动消息 2.0 诊断日志。失败一律静默：诊断不能反过来打断正常链路。 */
export const appendAmsgDiagEntry = (entry: AmsgDiagEntry): void => {
  try {
    const raw = localStorage.getItem(AMSG_DIAG_KEY);
    const list = raw ? JSON.parse(raw) : [];
    const next = Array.isArray(list) ? [...list, entry].slice(-AMSG_DIAG_LIMIT) : [entry];
    localStorage.setItem(AMSG_DIAG_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
};

/**
 * 记录一条主动消息 2.0 诊断日志。三写：console / localStorage / devDebug。
 * stage 必填；其他字段按需。
 */
export const amsgDiag = (input: RawAmsgDiagInput): void => {
  const entry = buildAmsgDiagEntry(input);
  try {
    console.info('[AmsgDiag]', entry);
  } catch {
    /* ignore */
  }
  appendAmsgDiagEntry(entry);
  appendDevDebugLog('amsg2', { label: input.stage, data: entry });
};

/** 最近 limit 条，最新在最前。 */
export const readRecentAmsgDiag = (limit: number): AmsgDiagEntry[] => {
  try {
    const raw = localStorage.getItem(AMSG_DIAG_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.slice(-limit).reverse() : [];
  } catch {
    return [];
  }
};

/** 全部条目，最新在最前。 */
export const readAllAmsgDiag = (): AmsgDiagEntry[] => readRecentAmsgDiag(AMSG_DIAG_LIMIT);

/** 清空诊断日志。 */
export const clearAmsgDiag = (): void => {
  try {
    localStorage.removeItem(AMSG_DIAG_KEY);
  } catch {
    /* ignore */
  }
};

/** 导出成 JSON 文本（含构建版本）。空时返回空串，调用方据此不做动作。 */
export const formatAmsgDiagLog = (): string => {
  const entries = readAllAmsgDiag();
  if (entries.length === 0) return '';
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    build: BUILD_LABEL,
    side: 'page',
    count: entries.length,
    entries,
  }, null, 2);
};

/**
 * 导出 page + Android 两侧合并的诊断日志。
 * 安卓端通过 AmsgUnifiedPushPlugin.dumpAmsgDiag() 拿 ring buffer 内容。
 * 跨设备不可达时（如 web 端 / 旧 APK）只导出 page 端。
 */
export const formatFullAmsgDiagLog = async (): Promise<string> => {
  const pageEntries = readAllAmsgDiag();
  let androidEntries: AmsgDiagEntry[] = [];
  try {
    if (isUnifiedPushPlatform() && typeof (NativeAmsgUnifiedPush as any)?.dumpAmsgDiag === 'function') {
      const raw = await (NativeAmsgUnifiedPush as any).dumpAmsgDiag();
      // Capacitor 插件 resolve 必须传 JSObject，所以 wrapper 是 { payload: '<json 字符串>' }。
      // 旧版本（直接 resolve string）也兜底兼容。
      const payloadString = typeof raw === 'string' && raw.trim() ? raw
        : raw && typeof (raw as any).payload === 'string' ? (raw as any).payload as string
        : '';
      if (payloadString.trim()) {
        const parsed = JSON.parse(payloadString);
        if (Array.isArray(parsed)) androidEntries = parsed as AmsgDiagEntry[];
      }
    }
  } catch {
    /* 安卓端不可达时静默 */
  }
  if (pageEntries.length === 0 && androidEntries.length === 0) return '';
  const merged = [
    ...pageEntries.map((entry) => ({ side: 'page', ...entry })),
    ...androidEntries.map((entry) => ({ side: 'android', ...entry })),
  ].sort((a, b) => String(b.ts ?? '').localeCompare(String(a.ts ?? '')));
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    build: BUILD_LABEL,
    count: merged.length,
    pageCount: pageEntries.length,
    androidCount: androidEntries.length,
    entries: merged,
  }, null, 2);
};

/** 截 endpoint 给前端显示用，避免泄露完整 URL。 */
export { redactEndpoint };