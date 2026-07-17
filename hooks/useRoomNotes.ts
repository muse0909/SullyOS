// useRoomNotes — 私密记事数据 hook（暮色 2026-07-17：抽离 RoomApp 逻辑给 PrivateNotesPage 共用）
// 职责：加载 / 删 / 加（AI 写时）/ 加回复（用户对 AI 写的便签回复）
// 筛选（关键词/日期/type/角色）放在调用方（PrivateNotesPage / RoomApp）做，本 hook 不掺 UI 关注点

import { useCallback, useEffect, useState } from 'react';
import { DB } from '../utils/db';
import { RoomNote, NoteReply } from '../types';

export interface UseRoomNotesResult {
    notes: RoomNote[];                 // 倒序：最新在上
    loading: boolean;
    refresh: () => Promise<void>;
    addNote: (note: RoomNote) => Promise<void>;
    deleteNote: (id: string) => Promise<void>;
    addReply: (noteId: string, reply: Omit<NoteReply, 'id' | 'parentNoteId'>) => Promise<void>;
}

export function useRoomNotes(charId?: string | null): UseRoomNotesResult {
    const [notes, setNotes] = useState<RoomNote[]>([]);
    const [loading, setLoading] = useState<boolean>(true);

    const refresh = useCallback(async () => {
        if (!charId) {
            setNotes([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const list = await DB.getRoomNotes(charId);
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

    const addNote = useCallback(async (note: RoomNote) => {
        await DB.saveRoomNote(note);
        // 局部追加，避免一次完整 refresh
        setNotes(prev => [note, ...prev].sort((a, b) => b.timestamp - a.timestamp));
    }, []);

    const deleteNote = useCallback(async (id: string) => {
        await DB.deleteRoomNote(id);
        setNotes(prev => prev.filter(n => n.id !== id));
    }, []);

    const addReply = useCallback(async (
        noteId: string,
        reply: Omit<NoteReply, 'id' | 'parentNoteId'>,
    ) => {
        const newReply: NoteReply = {
            id: `reply_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            parentNoteId: noteId,
            ...reply,
        };
        // 先读后改再写：避免 put(note) 把 replies 之外的字段冲掉
        const target = notes.find(n => n.id === noteId);
        if (!target) {
            console.warn(`[useRoomNotes] addReply: 找不到 note ${noteId}`);
            return;
        }
        const updated: RoomNote = {
            ...target,
            replies: [...(target.replies || []), newReply],
        };
        await DB.saveRoomNote(updated);
        setNotes(prev => prev.map(n => n.id === noteId ? updated : n));
    }, [notes]);

    return { notes, loading, refresh, addNote, deleteNote, addReply };
}
