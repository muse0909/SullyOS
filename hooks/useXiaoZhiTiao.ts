// useXiaoZhiTiao — 小纸条数据 hook（2026-07-22：跟 useRoomNotes 完全独立，互不可见）
// 暮色原话："小纸条完全脱离小小窝 app" — 单独 store / 单独 hook / 单独 token
// 职责：加载 / 删 / 加（AI 写时）/ 加回复（用户对 AI 写的小纸条回复）
// 筛选（关键词/日期/type/角色）放在调用方（XiaoZhiTiaoPage）做

import { useCallback, useEffect, useState } from 'react';
import { DB } from '../utils/db';
import { XiaoZhiTiao, XiaoZhiTiaoReply } from '../types';

export interface UseXiaoZhiTiaoResult {
    notes: XiaoZhiTiao[];            // 倒序：最新在上
    loading: boolean;
    refresh: () => Promise<void>;
    addNote: (note: XiaoZhiTiao) => Promise<void>;
    deleteNote: (id: string) => Promise<void>;
    addReply: (noteId: string, reply: Omit<XiaoZhiTiaoReply, 'id' | 'parentNoteId'>) => Promise<void>;
}

export function useXiaoZhiTiao(charId?: string | null): UseXiaoZhiTiaoResult {
    const [notes, setNotes] = useState<XiaoZhiTiao[]>([]);
    const [loading, setLoading] = useState<boolean>(true);

    const refresh = useCallback(async () => {
        if (!charId) {
            setNotes([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const list = await DB.getXiaoZhiTiaos(charId);
            // 倒序：最新在上
            list.sort((a, b) => b.timestamp - a.timestamp);
            setNotes(list);
        } finally {
            setLoading(false);
        }
    }, [charId]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const addNote = useCallback(async (note: XiaoZhiTiao) => {
        await DB.saveXiaoZhiTiao(note);
        setNotes(prev => [note, ...prev].sort((a, b) => b.timestamp - a.timestamp));
    }, []);

    const deleteNote = useCallback(async (id: string) => {
        await DB.deleteXiaoZhiTiao(id);
        setNotes(prev => prev.filter(n => n.id !== id));
    }, []);

    const addReply = useCallback(async (
        noteId: string,
        reply: Omit<XiaoZhiTiaoReply, 'id' | 'parentNoteId'>,
    ) => {
        const newReply: XiaoZhiTiaoReply = {
            id: `xzt_reply_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            parentNoteId: noteId,
            ...reply,
        };
        const target = notes.find(n => n.id === noteId);
        if (!target) {
            console.warn(`[useXiaoZhiTiao] addReply: 找不到 note ${noteId}`);
            return;
        }
        const updated: XiaoZhiTiao = {
            ...target,
            replies: [...(target.replies || []), newReply],
        };
        await DB.saveXiaoZhiTiao(updated);
        setNotes(prev => prev.map(n => n.id === noteId ? updated : n));
    }, [notes]);

    return { notes, loading, refresh, addNote, deleteNote, addReply };
}
