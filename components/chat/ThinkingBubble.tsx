/**
 * ThinkingBubble.tsx
 *
 * 在聊天中显示 AI 的思维链（<think> 块内容）的可折叠气泡。
 * 通过 localStorage.os_last_thinking 读取。
 */
import React, { useState, useEffect } from 'react';
import { getLastThinking } from '../../hooks/useThinkingDisplay';

const ThinkingBubble: React.FC = () => {
    const [thinking, setThinking] = useState<string | null>(getLastThinking());
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
        const interval = setInterval(() => {
            const val = getLastThinking();
            if (val !== thinking) setThinking(val);
        }, 1000);
        return () => clearInterval(interval);
    }, [thinking]);

    if (!thinking) return null;

    return (
        <div className="mb-2 animate-fade-in">
            <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1.5 text-[10px] text-slate-400 hover:text-slate-500 transition-colors px-1 py-0.5 rounded-lg hover:bg-slate-50"
            >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
                <span>🤔 推理过程 {expanded ? '' : `(${thinking.length}字)`}</span>
            </button>
            {expanded && (
                <div className="mt-1 ml-4 pl-3 border-l-2 border-amber-200 bg-amber-50/50 rounded-r-lg p-2 text-[11px] text-slate-600 leading-relaxed whitespace-pre-wrap animate-slide-down">
                    {thinking}
                </div>
            )}
        </div>
    );
};

export default ThinkingBubble;