/**
 * 麦麦 2026-09-23 22:50：主动消息 2.0 全链路诊断日志查看器。
 *
 * 展示 page + Android 合并 trace,带筛选 + 复制 + 清空。
 * 满屏 fixed 定位,在 Settings 弹窗外层。
 */

import React, { useEffect, useState } from 'react';
import Modal from '../os/Modal';
import {
  formatFullAmsgDiagLog,
  readAllAmsgDiag,
  clearAmsgDiag,
  type AmsgDiagEntry,
} from '../../utils/amsgDiag';

interface AmsgDiagLogViewerProps {
  isOpen: boolean;
  onClose: () => void;
}

const STAGE_OPTIONS = [
  { id: 'all', label: '全部' },
  { id: 'wakeup-token-parsed', label: '1. token 解析' },
  { id: 'wakeup-write-task', label: '2. 写任务' },
  { id: 'wakeup-worker-ack', label: '3. Worker ack' },
  { id: 'wakeup-android-receive', label: '4. Android 收' },
  { id: 'wakeup-push-received', label: '5. push 派发' },
  { id: 'wakeup-payload-parsed', label: '6. payload 解析' },
  { id: 'wakeup-save-message', label: '7. 写消息' },
  { id: 'wakeup-event-dispatched', label: '8. 派事件' },
  { id: 'wakeup-chat-ui', label: '9. Chat 刷新' },
  { id: 'wakeup-system-notification', label: '10. 系统通知' },
  { id: 'wakeup-final', label: '11. 链终' },
  { id: 'wakeup-failed', label: '失败' },
] as const;

const shortTime = (iso: string): string => {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
  } catch {
    return iso;
  }
};

export const AmsgDiagLogViewer: React.FC<AmsgDiagLogViewerProps> = ({ isOpen, onClose }) => {
  const [entries, setEntries] = useState<AmsgDiagEntry[]>([]);
  const [filterStage, setFilterStage] = useState<typeof STAGE_OPTIONS[number]['id']>('all');
  const [filterMsgId, setFilterMsgId] = useState('');
  const [busy, setBusy] = useState(false);
  const [exportJson, setExportJson] = useState<string>('');

  // 打开时刷新一次
  useEffect(() => {
    if (!isOpen) return;
    setEntries(readAllAmsgDiag());
  }, [isOpen]);

  // 关掉时清掉导出缓存(避免下次打开看到上次)
  useEffect(() => {
    if (!isOpen) setExportJson('');
  }, [isOpen]);

  const filtered = entries.filter((entry) => {
    if (filterStage !== 'all' && entry.stage !== filterStage) return false;
    if (filterMsgId && !(entry.msgId ?? '').includes(filterMsgId)) return false;
    return true;
  });

  const handleCopy = async () => {
    setBusy(true);
    try {
      // 真拿到 Android 端 + page 端合并
      const merged = await formatFullAmsgDiagLog();
      const text = merged || filtered.map((entry) => JSON.stringify(entry)).join('\n');
      setExportJson(text);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch (e) {
      console.warn('[AmsgDiagLogViewer] copy 失败', e);
    } finally {
      setBusy(false);
    }
  };

  const handleClear = () => {
    if (!window.confirm('清空诊断日志？两端都清。')) return;
    clearAmsgDiag();
    setEntries([]);
    // Android 端也尝试清
    void (async () => {
      try {
        const { NativeAmsgUnifiedPush } = await import('../../utils/unifiedPushPlugin');
        if (typeof (NativeAmsgUnifiedPush as any)?.clearAmsgDiag === 'function') {
          await (NativeAmsgUnifiedPush as any).clearAmsgDiag();
        }
      } catch {
        /* ignore */
      }
    })();
  };

  return (
    <Modal
      isOpen={isOpen}
      title="主动消息 2.0 诊断日志"
      onClose={onClose}
      footer={(
        <div className="flex gap-2 w-full">
          <button
            type="button"
            onClick={handleClear}
            disabled={entries.length === 0}
            className="flex-1 py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl active:scale-95 transition-transform disabled:opacity-50"
          >
            清空
          </button>
          <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={filtered.length === 0}
            className="flex-1 py-3 bg-violet-300 text-violet-900 font-bold rounded-2xl active:scale-95 transition-transform disabled:opacity-50"
          >
            {busy ? '复制中…' : '复制全部'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl active:scale-95 transition-transform"
          >
            关闭
          </button>
        </div>
      )}
    >
      <div className="space-y-3 text-xs text-slate-600">
        {/* 筛选 */}
        <div className="flex flex-col gap-2 bg-slate-50 rounded-xl p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold text-slate-500 shrink-0">阶段</span>
            <select
              value={filterStage}
              onChange={(e) => setFilterStage(e.target.value as typeof STAGE_OPTIONS[number]['id'])}
              className="flex-1 px-2 py-1 text-xs bg-white border border-slate-200 rounded-lg"
            >
              {STAGE_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-slate-500 shrink-0">msgId</span>
            <input
              type="text"
              value={filterMsgId}
              onChange={(e) => setFilterMsgId(e.target.value)}
              placeholder="按 messageId 过滤"
              className="flex-1 px-2 py-1 text-xs bg-white border border-slate-200 rounded-lg"
            />
          </div>
          <div className="text-[10px] text-slate-400">
            共 {entries.length} 条 · 显示 {filtered.length} 条
          </div>
        </div>

        {/* 列表 */}
        <div className="space-y-1 max-h-[55vh] overflow-y-auto no-scrollbar">
          {filtered.length === 0 ? (
            <p className="text-center text-slate-400 py-8">
              还没有日志。江澈说一句话触发 [schedule_next_wakeup] 后,这里会逐条出现。
            </p>
          ) : null}
          {filtered.map((entry, idx) => (
            <div
              key={`${entry.ts}-${idx}`}
              className={`rounded-lg px-2.5 py-2 border ${
                entry.ok
                  ? 'bg-emerald-50/60 border-emerald-100'
                  : 'bg-rose-50/60 border-rose-100'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`text-[10px] font-bold ${entry.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {entry.stage}
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  {shortTime(entry.ts ?? '')}
                </span>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-slate-500">
                {entry.msgId ? <span><b className="text-slate-600">msgId</b> {entry.msgId}</span> : null}
                {entry.taskId ? <span><b className="text-slate-600">taskId</b> {entry.taskId}</span> : null}
                {entry.charId ? <span className="col-span-2"><b className="text-slate-600">charId</b> {entry.charId}</span> : null}
                {entry.fireAt ? <span><b className="text-slate-600">fireAt</b> {new Date(entry.fireAt).toISOString()}</span> : null}
                {entry.reason ? <span className="col-span-2"><b className="text-slate-600">reason</b> {entry.reason}</span> : null}
                {entry.source ? <span><b className="text-slate-600">source</b> {entry.source}</span> : null}
              </div>
              {!entry.ok && entry.error ? (
                <div className="mt-1 text-[10px] text-rose-700 leading-relaxed">
                  ⚠ {entry.error}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {exportJson ? (
          <div className="bg-slate-50 rounded-xl p-3 text-[10px] text-slate-500 leading-relaxed">
            ✓ 已复制合并日志到剪贴板。共 <b>{entries.length}</b> 条 page + Android 合并。
          </div>
        ) : null}
      </div>
    </Modal>
  );
};

export default AmsgDiagLogViewer;