// 暮色 2026-08-04：Gemini 直连 key 池管理弹窗
//   - 复用 components/os/Modal.tsx（暮色 2026-07-02 拍板的弹窗规范：max-w-sm + rounded-[2.5rem] + max-h-[80vh]）
//   - 状态灯：active=绿 / rate-limited=黄 / dead=红
//   - key 显示：前 4 后 4 短码（AIza...abc）
//   - 添加：行内输入框；删除：每行 × 按钮
//   - 重置：dead 状态可以手动点 ↻ 改回 active
//   - 底部：保存（写回 apiConfig）+ 取消

import React, { useState, useEffect, useMemo } from 'react';
import Modal from './Modal';
import {
  getGeminiKeyStatuses,
  resetGeminiKeyStatus,
  shortKey,
  statusColor,
  type GeminiChannel,
  type GeminiKeyState,
} from '../../utils/geminiKeyPool';

interface GeminiKeyPoolModalProps {
  isOpen: boolean;
  onClose: () => void;
  channel: GeminiChannel;
  channelLabel: string; // "主 API" / "识图" / "副 API"
  keys: string[];
  onSave: (keys: string[]) => void;
}

const GeminiKeyPoolModal: React.FC<GeminiKeyPoolModalProps> = ({
  isOpen,
  onClose,
  channel,
  channelLabel,
  keys,
  onSave,
}) => {
  // 本地编辑态（不直接改 props）
  const [localKeys, setLocalKeys] = useState<string[]>(keys);
  const [newKey, setNewKey] = useState('');
  // 状态刷新 trigger（手动 +1 触发 useMemo 重算）
  const [statusTick, setStatusTick] = useState(0);

  // 打开时同步外部 keys → localKeys
  useEffect(() => {
    if (isOpen) {
      setLocalKeys(keys);
      setNewKey('');
    }
  }, [isOpen, keys]);

  // 拿 key 状态（池里每个 key 当前的 active/rate-limited/dead + 上次错误）
  const statuses = useMemo<GeminiKeyState[]>(() => {
    return getGeminiKeyStatuses(channel, localKeys);
    // statusTick 用来手动触发重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, localKeys, statusTick]);

  // 每 2 秒刷一次状态（cooldown 时间在变）
  useEffect(() => {
    if (!isOpen) return;
    const t = setInterval(() => setStatusTick(v => v + 1), 2000);
    return () => clearInterval(t);
  }, [isOpen]);

  const handleAdd = () => {
    const k = newKey.trim();
    if (!k) return;
    if (localKeys.includes(k)) {
      setNewKey('');
      return;
    }
    setLocalKeys(prev => [...prev, k]);
    setNewKey('');
  };

  const handleDelete = (idx: number) => {
    setLocalKeys(prev => prev.filter((_, i) => i !== idx));
  };

  const handleReset = (idx: number) => {
    resetGeminiKeyStatus(channel, idx);
    setStatusTick(v => v + 1);
  };

  const handleSave = () => {
    onSave(localKeys.filter(k => k && k.trim()));
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Gemini 密钥池 · ${channelLabel}`}
      footer={
        <>
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl active:scale-95 transition-transform"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="flex-1 py-3 bg-sky-500 text-white font-bold rounded-2xl shadow-lg shadow-sky-500/20 active:scale-95 transition-transform"
          >
            保存（{localKeys.length} 个）
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[10px] text-slate-400 leading-relaxed">
          多个 Gemini key 自动轮询。失败时自动切下一个：429 配额耗尽等 60 秒、401 key 失效会标红、其它网络错误等 5 秒。
        </p>

        {/* 列表 */}
        {localKeys.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-400 bg-slate-50/60 rounded-2xl">
            还没有 key。在下面输入框填一个，回车添加。
          </div>
        ) : (
          <div className="space-y-2">
            {localKeys.map((k, idx) => {
              const s = statuses[idx];
              const sc = s ? statusColor(s.status) : null;
              return (
                <div
                  key={`${idx}-${k.slice(0, 6)}`}
                  className="bg-slate-50/60 rounded-2xl p-3 border border-slate-200/40"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400 w-5 text-center shrink-0">
                      {idx + 1}
                    </span>
                    {sc && (
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${sc.dot}`}
                        title={sc.label}
                      />
                    )}
                    <span className="flex-1 min-w-0 font-mono text-xs text-slate-700 truncate">
                      {shortKey(k)}
                    </span>
                    {sc && (
                      <span className={`text-[10px] font-bold shrink-0 ${sc.text}`}>
                        {sc.label}
                      </span>
                    )}
                    {s?.status === 'dead' && (
                      <button
                        onClick={() => handleReset(idx)}
                        className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-emerald-500 active:scale-90 transition-all shrink-0"
                        title="恢复此 key"
                      >
                        ↻
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(idx)}
                      className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-rose-500 active:scale-90 transition-all shrink-0"
                      title="删除"
                    >
                      ×
                    </button>
                  </div>
                  {s?.lastError && s.status !== 'active' && (
                    <div className="mt-1.5 ml-7 text-[10px] text-slate-400 truncate" title={s.lastError}>
                      {s.lastError}
                    </div>
                  )}
                  {s && s.status === 'rate-limited' && s.cooldownUntil && s.cooldownUntil > Date.now() && (
                    <div className="mt-1 ml-7 text-[10px] text-amber-500">
                      {Math.max(1, Math.ceil((s.cooldownUntil - Date.now()) / 1000))}s 后恢复
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* 添加新 key */}
        <div className="flex items-center gap-2 pt-2">
          <input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAdd();
              }
            }}
            placeholder="输入新 key（Google AI Studio）"
            className="flex-1 bg-white border border-slate-200/60 rounded-xl px-3 py-2 text-xs font-mono focus:border-sky-300 focus:bg-white transition-all"
          />
          <button
            onClick={handleAdd}
            disabled={!newKey.trim()}
            className={`px-3 py-2 rounded-xl text-xs font-bold active:scale-95 transition-all ${
              newKey.trim()
                ? 'bg-sky-500 text-white shadow-md shadow-sky-500/20'
                : 'bg-slate-100 text-slate-400'
            }`}
          >
            +
          </button>
        </div>

        {localKeys.length > 0 && (
          <p className="text-[10px] text-slate-300 text-center">
            共 {localKeys.length} 个 key · 顺序 = 轮询优先级
          </p>
        )}
      </div>
    </Modal>
  );
};

export default GeminiKeyPoolModal;
