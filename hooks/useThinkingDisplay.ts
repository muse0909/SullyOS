import { useState, useEffect, useRef } from 'react';

/**
 * useThinkingDisplay.ts
 *
 * 读取 AI 回复中的 <think> 块内容（思维链/推理过程），
 * 供 UI 组件展示给用户。
 *
 * useChatAI.ts 中的 normalizeAiContent 会在 strip <think> 之前
 * 将思维链文本存入 localStorage key: os_last_thinking。
 */

const STORAGE_KEY = 'os_last_thinking';

export function getLastThinking(): string | null {
    try {
        return localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

export function clearThinking(): void {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {}
}

/**
 * React hook：监听思维链变化
 * pollInterval 毫秒轮询一次（默认 1000ms）
 */
export function useThinkingDisplay(pollInterval = 1000): string | null {
    const [thinking, setThinking] = useState<string | null>(getLastThinking());
    const intervalRef = useRef<ReturnType<typeof setInterval>>();

    useEffect(() => {
        setThinking(getLastThinking());
        intervalRef.current = setInterval(() => {
            setThinking(getLastThinking());
        }, pollInterval);
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [pollInterval]);

    return thinking;
}