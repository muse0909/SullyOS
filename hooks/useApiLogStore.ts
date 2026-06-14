/**
 * useApiLogStore.ts
 *
 * API 调用日志存储。记录每次 AI 请求的 URL、耗时、token 用量、状态码，
 * 供 Settings 中的日志页面查看。
 */
import { useState, useCallback, useRef, useEffect } from 'react';

export interface ApiLogEntry {
    id: number;
    timestamp: number;
    url: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    durationMs: number;
    status: number;
    label: string;
}

const MAX_LOG = 200;
const STORAGE_KEY = 'os_api_logs';

let logs: ApiLogEntry[] = [];
let nextId = 1;
let listeners: Set<() => void> = new Set();

function notify() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(logs.slice(-MAX_LOG))); } catch {}
    listeners.forEach(fn => fn());
}

export function addApiLog(entry: Omit<ApiLogEntry, 'id' | 'timestamp'>) {
    logs = [...logs, { ...entry, id: nextId++, timestamp: Date.now() }].slice(-MAX_LOG);
    notify();
}

export function clearApiLogs() {
    logs = [];
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    notify();
}

export function getApiLogs(): ApiLogEntry[] {
    return logs;
}

export function useApiLogStore(): { logs: ApiLogEntry[]; clear: () => void } {
    const [state, setState] = useState<ApiLogEntry[]>(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved) as ApiLogEntry[];
                logs = parsed;
                nextId = (parsed.reduce((m, l) => Math.max(m, l.id), 0) || 0) + 1;
                return parsed;
            }
        } catch {}
        return [];
    });

    useEffect(() => {
        const handler = () => setState([...logs]);
        listeners.add(handler);
        return () => { listeners.delete(handler); };
    }, []);

    const clear = useCallback(() => {
        clearApiLogs();
        setState([]);
    }, []);

    return { logs: state, clear };
}