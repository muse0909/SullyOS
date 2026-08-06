
import React, { useState, useEffect } from 'react';
import { PencilSimple, Trash, X } from '@phosphor-icons/react';
import type { PipelineResult } from '../../utils/memoryPalace/pipeline';

interface MemoryReviewModalProps {
    result: PipelineResult;
    onClose: () => void;
    /** 提交编辑（外部负责 save + 重跑 embedding） */
    onEditMemory: (id: string, newContent: string) => Promise<void>;
    /** 提交删除（外部负责清 vec/links/node） */
    onDeleteMemory: (id: string) => Promise<void>;
}

const ROOM_META: Record<string, { label: string; color: string }> = {
    living_room: { label: '客厅', color: '#f59e0b' },
    bedroom: { label: '卧室', color: '#8b5cf6' },
    study: { label: '书房', color: '#0ea5e9' },
    user_room: { label: '用户房间', color: '#ec4899' },
    self_room: { label: '自我房间', color: '#10b981' },
    attic: { label: '阁楼', color: '#6366f1' },
    windowsill: { label: '窗台', color: '#14b8a6' },
};

/**
 * 记忆整理结果弹窗（D7：已落库，可编辑/删除）。
 * 两路复用：
 *  ① 自动提取（useChatAI.ts:4401 setMemoryPalaceResult）
 *  ② 一键向量化完成（Chat.tsx:handleForceVectorize 构造的 result）
 * 点"确认"才提交 pending 变更；点"取消"丢弃。
 */
const MemoryReviewModal: React.FC<MemoryReviewModalProps> = ({
    result,
    onClose,
    onEditMemory,
    onDeleteMemory,
}) => {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState('');
    const [pendingEdits, setPendingEdits] = useState<Map<string, string>>(new Map());
    const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set());
    const [submitting, setSubmitting] = useState(false);

    // result 换了 → 清掉 pending 状态（防 stale 弹窗）
    useEffect(() => {
        setEditingId(null);
        setEditDraft('');
        setPendingEdits(new Map());
        setPendingDeletes(new Set());
        setSubmitting(false);
    }, [result]);

    const visibleMemories = result.memories.filter(m => !pendingDeletes.has(m.id));

    const startEdit = (id: string, content: string) => {
        setEditingId(id);
        // 优先显示已编辑的草稿
        setEditDraft(pendingEdits.get(id) ?? content);
    };

    const saveEditDraft = (id: string) => {
        const draft = editDraft.trim();
        if (!draft) return;
        const original = result.memories.find(m => m.id === id)?.content;
        if (draft === original) {
            // 没改 → 清掉 pending
            setPendingEdits(prev => {
                const next = new Map(prev);
                next.delete(id);
                return next;
            });
        } else {
            setPendingEdits(prev => new Map(prev).set(id, draft));
        }
        setEditingId(null);
        setEditDraft('');
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditDraft('');
    };

    const toggleDelete = (id: string) => {
        setPendingDeletes(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const pendingCount = pendingEdits.size + pendingDeletes.size;

    const handleConfirm = async () => {
        if (submitting) return;
        setSubmitting(true);
        try {
            // 1. 先删：避免删过的 id 在编辑列表里 ghost
            for (const id of pendingDeletes) {
                try { await onDeleteMemory(id); } catch { /* 调用方 toast */ }
            }
            // 2. 再编辑：跳过已删的（双重保险）
            for (const [id, newContent] of pendingEdits) {
                if (pendingDeletes.has(id)) continue;
                try { await onEditMemory(id, newContent); } catch { /* 调用方 toast */ }
            }
            onClose();
        } catch {
            onClose();
        } finally {
            setSubmitting(false);
        }
    };

    const handleCancel = () => {
        if (submitting) return;
        onClose();
    };

    return (
        <div
            className="absolute inset-0 z-[200] flex items-center justify-center p-4 animate-fade-in"
            style={{
                pointerEvents: 'all',
                background: 'rgba(15,23,42,0.55)',
            }}
            onClick={handleCancel}
        >
            <div
                className="w-full max-w-sm max-h-[82vh] overflow-hidden flex flex-col relative"
                style={{
                    background: 'linear-gradient(160deg, #ffffff 0%, #f8fafc 100%)',
                    borderRadius: 28,
                    border: '1px solid rgba(148,163,184,0.18)',
                    boxShadow: '0 20px 50px -20px rgba(15,23,42,0.35)',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div
                    className="absolute top-0 left-0 right-0 h-[2px] pointer-events-none"
                    style={{ background: 'linear-gradient(90deg, transparent, #6366f1, #a5b4fc, #6366f1, transparent)' }}
                />
                {/* Header */}
                <div className="px-6 pt-7 pb-4 text-center">
                    <div
                        className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center mb-3"
                        style={{
                            background: 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(129,140,248,0.06))',
                            border: '1px solid rgba(99,102,241,0.15)',
                        }}
                    >
                        <span style={{ fontSize: 26 }}>🗂️</span>
                    </div>
                    <div className="text-[10px] tracking-[0.25em] uppercase font-semibold" style={{ color: '#6366f1' }}>Memory Palace</div>
                    <p className="text-[17px] font-bold mt-1" style={{ color: '#0f172a' }}>记忆整理完成</p>
                    <p className="text-[11px] text-slate-400 mt-1">
                        新增 {result.stored} 条 · 去重跳过 {result.skipped} 条
                        {result.batches.length > 1 && ` · ${result.batches.length} 批`}
                    </p>
                    {result.batches.some(b => !b.ok) && (
                        <p className="text-[10px] text-red-500 mt-1">
                            {result.batches.filter(b => !b.ok).map(b => `batch ${b.index} 失败`).join(', ')}
                        </p>
                    )}
                    {pendingCount > 0 && (
                        <p className="text-[10px] text-amber-600 mt-1.5 font-semibold">
                            {pendingEdits.size > 0 && `${pendingEdits.size} 条待编辑`}
                            {pendingEdits.size > 0 && pendingDeletes.size > 0 && ' · '}
                            {pendingDeletes.size > 0 && `${pendingDeletes.size} 条待删除`}
                        </p>
                    )}
                </div>

                {/* Body: 记忆列表（可编辑/删除） */}
                <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-2 no-scrollbar">
                    {visibleMemories.map((m) => {
                        const meta = ROOM_META[m.room] || { label: m.room, color: '#64748b' };
                        const isEditing = editingId === m.id;
                        const editedContent = pendingEdits.get(m.id);
                        const wasEdited = editedContent !== undefined;
                        const displayContent = editedContent ?? m.content;
                        return (
                            <div
                                key={m.id}
                                className="p-3 rounded-2xl"
                                style={{
                                    background: wasEdited ? 'rgba(251,191,36,0.08)' : 'rgba(255,255,255,0.75)',
                                    border: `1px solid ${wasEdited ? '#fbbf24' : meta.color}44`,
                                    boxShadow: `0 2px 8px ${meta.color}14, inset 0 1px 0 rgba(255,255,255,0.8)`,
                                }}
                            >
                                <div className="flex items-center gap-2 mb-1.5">
                                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                                        style={{ background: `${meta.color}18`, color: meta.color }}
                                    >
                                        {meta.label}
                                    </span>
                                    <span className="text-[10px] text-slate-400">{m.mood}</span>
                                    <span className="text-[10px] font-bold" style={{ color: '#f59e0b' }}>{'★'.repeat(Math.min(m.importance, 5))}</span>
                                    {wasEdited && (
                                        <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: '#fbbf24', color: 'white' }}>
                                            已编辑
                                        </span>
                                    )}
                                    {/* 编辑/删除按钮（右上角） */}
                                    {!isEditing && (
                                        <div className="ml-auto flex items-center gap-1">
                                            <button
                                                onClick={() => startEdit(m.id, m.content)}
                                                disabled={submitting}
                                                className="w-7 h-7 flex items-center justify-center rounded-full active:scale-90 transition-transform"
                                                style={{ background: 'rgba(99,102,241,0.12)', color: '#6366f1' }}
                                                aria-label="编辑"
                                            >
                                                <PencilSimple size={14} weight="bold" />
                                            </button>
                                            <button
                                                onClick={() => toggleDelete(m.id)}
                                                disabled={submitting}
                                                className="w-7 h-7 flex items-center justify-center rounded-full active:scale-90 transition-transform"
                                                style={{ background: 'rgba(239,68,68,0.10)', color: '#ef4444' }}
                                                aria-label="删除"
                                            >
                                                <Trash size={14} weight="bold" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                                {isEditing ? (
                                    <div className="space-y-2">
                                        <textarea
                                            value={editDraft}
                                            onChange={e => setEditDraft(e.target.value)}
                                            autoFocus
                                            className="w-full text-[12px] text-slate-700 leading-relaxed p-2 rounded-lg border border-indigo-200 focus:border-indigo-400 focus:outline-none"
                                            style={{ minHeight: 60, fontFamily: 'inherit', resize: 'vertical' }}
                                        />
                                        <div className="flex gap-2 justify-end">
                                            <button
                                                onClick={cancelEdit}
                                                className="px-3 py-1 text-[11px] font-semibold rounded-full text-slate-500 bg-slate-100 active:scale-95 transition-transform"
                                            >
                                                取消
                                            </button>
                                            <button
                                                onClick={() => saveEditDraft(m.id)}
                                                disabled={!editDraft.trim()}
                                                className="px-3 py-1 text-[11px] font-semibold rounded-full text-white active:scale-95 transition-transform"
                                                style={{ background: editDraft.trim() ? '#6366f1' : '#9ca3af' }}
                                            >
                                                保存草稿
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-[12px] text-slate-700 leading-relaxed" style={{
                                        textDecoration: wasEdited ? 'none' : 'none',
                                    }}>
                                        {displayContent}
                                    </p>
                                )}
                                {m.tags.length > 0 && !isEditing && (
                                    <div className="flex gap-1 mt-2 flex-wrap">
                                        {m.tags.map((t, j) => (
                                            <span key={j} className="text-[9px] px-1.5 py-0.5 rounded-full"
                                                style={{ background: 'rgba(148,163,184,0.15)', color: '#64748b' }}
                                            >{t}</span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    {visibleMemories.length === 0 && (
                        <p className="text-center text-xs text-slate-400 py-4">
                            {pendingDeletes.size > 0 ? '已全部标记为删除' : '本次未提取到新记忆'}
                        </p>
                    )}
                </div>

                {/* Footer: 取消 / 确认 */}
                <div className="px-6 pb-6 pt-2 flex gap-2">
                    <button
                        onClick={handleCancel}
                        disabled={submitting}
                        className="flex-1 py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl active:scale-[0.98] transition-transform"
                    >
                        取消
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={submitting}
                        className="flex-1 py-3 text-white text-[13px] font-bold rounded-2xl active:scale-[0.98] transition-transform"
                        style={{
                            background: submitting
                                ? '#9ca3af'
                                : (pendingCount > 0
                                    ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                                    : 'linear-gradient(135deg, #6366f1, #4f46e5)'),
                            boxShadow: submitting ? 'none' : '0 6px 18px -6px rgba(79,70,229,0.5)',
                        }}
                    >
                        {submitting
                            ? '处理中...'
                            : (pendingCount > 0 ? `确认（${pendingCount} 项变更）` : '确认')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MemoryReviewModal;
