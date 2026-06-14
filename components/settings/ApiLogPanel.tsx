/**
 * ApiLogPanel.tsx
 *
 * API 调用日志查看面板，显示每次 AI 请求的 URL、模型、token 用量、耗时。
 * 可嵌入到 Settings.tsx 底部。
 */
import React from 'react';
import { useApiLogStore } from '../../hooks/useApiLogStore';
import { Terminal } from '@phosphor-icons/react';

const ApiLogPanel: React.FC = () => {
    const { logs, clear } = useApiLogStore();

    const formatTime = (ts: number) => new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    return (
        <section className="bg-white/80 rounded-3xl p-5 shadow-sm border border-white/50">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-slate-100 rounded-xl text-slate-600">
                        <Terminal size={18} weight="fill" />
                    </div>
                    <h2 className="text-sm font-semibold text-slate-600 tracking-wider">API 调用日志</h2>
                    <span className="text-[10px] text-slate-400 ml-1">({logs.length} 条)</span>
                </div>
                <button
                    onClick={clear}
                    className="text-[10px] text-red-400 hover:text-red-500 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
                >
                    清空
                </button>
            </div>

            {logs.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-8">暂无 API 调用记录。发送消息后会自动记录。</p>
            ) : (
                <div className="max-h-72 overflow-y-auto no-scrollbar space-y-1.5">
                    {logs.slice().reverse().map(log => (
                        <div
                            key={log.id}
                            className="flex flex-col gap-0.5 bg-slate-50 rounded-xl px-3 py-2 text-[10px]"
                        >
                            <div className="flex items-center justify-between">
                                <span className="font-mono text-slate-700 font-bold truncate max-w-[140px]">{log.model}</span>
                                <span className="text-slate-400 whitespace-nowrap">{formatTime(log.timestamp)}</span>
                            </div>
                            <div className="flex items-center gap-3 text-slate-400">
                                <span>↑{log.promptTokens}</span>
                                <span>↓{log.completionTokens}</span>
                                <span className="font-medium text-slate-500">∑{log.totalTokens}</span>
                                <span className={log.durationMs > 5000 ? 'text-red-400 font-medium' : 'text-slate-400'}>{log.durationMs}ms</span>
                                <span className={log.status === 200 ? 'text-emerald-500' : 'text-red-400'}>{log.status}</span>
                            </div>
                            <div className="text-[9px] text-slate-400 truncate">{log.url}</div>
                            {log.durationMs > 8000 && (
                                <div className="text-[9px] text-amber-500 font-medium">⚠️ 超过 8 秒，可能网络较慢</div>
                            )}
                        </div>
                    ))}
                </div>
            )}
            <p className="text-[9px] text-slate-300 text-center mt-3">仅保留最近 200 条记录，刷新页面不丢失</p>
        </section>
    );
};

export default ApiLogPanel;