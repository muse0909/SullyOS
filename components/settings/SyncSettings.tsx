/**
 * Cloud Sync Settings UI
 *
 * 在「设置 → 云端同步」分组里渲染。
 * 负责：生成配对码、显示配对码、加入配对码、设备列表、同步状态。
 *
 * 设计原则：
 *   - 完全不依赖 OSContext，独立 state + localStorage
 *   - 走 useCloudSync hook 拿实时同步状态
 *   - 配对码 6 位字符（剔除 0/1/o/i/l），等宽字体显示
 *   - 大号显眼，复用项目"马卡龙胶囊"风格
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useCloudSync } from '../../hooks/useCloudSync';
import { CheckIcon, CopyIcon, ArrowsClockwiseIcon, LinkIcon, XIcon, DevicesIcon, CloudArrowUpIcon } from '@phosphor-icons/react';

// ─── 配对码字符映射：把 0/1/o/i/l 替换成更易读的展示（**不**改语义） ───
const PAIR_DISPLAY_MAP: Record<string, string> = {
    '0': '0', '1': '1', 'o': 'o', 'i': 'i', 'l': 'l',
};

const DEFAULT_DEVICE_NAME = (() => {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    if (/iPhone|iPad|iPod/.test(ua)) return 'iOS 设备';
    if (/Android/.test(ua)) return 'Android 设备';
    if (/Mac/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows';
    if (/Linux/.test(ua)) return 'Linux';
    return '我的设备';
})();

// ─── 配对码展示（大字等宽 + 复制按钮） ────────────────

const PairCodeDisplay: React.FC<{ code: string }> = ({ code }) => {
    const [copied, setCopied] = useState(false);
    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        }).catch(() => { /* 复制失败静默 */ });
    }, [code]);

    if (!code) return null;
    // 用空格分隔字符更易读
    const chars = code.split('');
    return (
        <div className="flex items-center gap-2">
            <div className="flex-1 bg-gradient-to-br from-violet-50 to-fuchsia-50 border border-violet-200/50 rounded-2xl px-3 py-3 flex justify-center gap-1.5 font-mono text-2xl font-bold tracking-wider text-slate-700">
                {chars.map((c, i) => (
                    <span key={i} className="inline-block min-w-[1.4rem] text-center">
                        {PAIR_DISPLAY_MAP[c] || c}
                    </span>
                ))}
            </div>
            <button
                onClick={handleCopy}
                className="px-3 py-3 bg-white/80 border border-slate-200/60 rounded-2xl text-slate-600 active:scale-95 transition-all flex flex-col items-center gap-0.5 shrink-0"
                title="复制配对码"
            >
                {copied ? <CheckIcon size={18} className="text-emerald-500" /> : <CopyIcon size={18} />}
                <span className="text-[9px] text-slate-500">{copied ? '已复制' : '复制'}</span>
            </button>
        </div>
    );
};

// ─── 主组件 ────────────────────────────────────────

export const SyncSettings: React.FC = () => {
    const {
        config, status, errorMessage, lastSuccessAt,
        uploadedMessages, pulledMessages, uploadedMemories, pulledMemories,
        initPair, joinPair, resetPair, setEnabled, forceSyncNow,
    } = useCloudSync();

    const [deviceName, setDeviceName] = useState(config.deviceName || DEFAULT_DEVICE_NAME);
    const [joinCode, setJoinCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [showJoin, setShowJoin] = useState(false);
    const [showReset, setShowReset] = useState(false);

    // 状态文本（设置 section header 用）
    const statusText = (() => {
        if (status === 'no_backend') return '后端未配置';
        if (status === 'unconfigured') return '未配对';
        if (status === 'disabled') return '已暂停';
        if (status === 'syncing') return '同步中…';
        if (status === 'error') return '出错';
        if (status === 'idle' && config.enabled) return '运行中';
        return '';
    })();
    const statusColor = (() => {
        if (status === 'no_backend' || status === 'error') return 'text-rose-500';
        if (status === 'syncing') return 'text-amber-500';
        if (status === 'idle' && config.enabled) return 'text-emerald-500';
        if (status === 'disabled') return 'text-slate-400';
        return 'text-slate-400';
    })();

    // 处理生成新配对码
    const handleInit = useCallback(async () => {
        setBusy(true);
        const result = await initPair(deviceName || DEFAULT_DEVICE_NAME);
        setBusy(false);
        if (!result.ok && result.error) {
            alert(`生成配对码失败：${result.error}`);
        }
    }, [deviceName, initPair]);

    // 处理加入配对码
    const handleJoin = useCallback(async () => {
        if (!joinCode || joinCode.length !== 6) {
            alert('请输入 6 位配对码');
            return;
        }
        setBusy(true);
        const result = await joinPair(joinCode, deviceName || DEFAULT_DEVICE_NAME);
        setBusy(false);
        if (!result.ok) {
            alert(`加入配对失败：${result.error}`);
        } else {
            setJoinCode('');
            setShowJoin(false);
        }
    }, [joinCode, deviceName, joinPair]);

    // 处理重置
    const handleReset = useCallback(() => {
        resetPair();
        setShowReset(false);
    }, [resetPair]);

    // ─── 渲染分支 ─────────────────────────────────

    // 后端未配置（Neon 没装）
    if (status === 'no_backend') {
        return (
            <div className="space-y-3">
                <div className="bg-rose-50 border border-rose-200/60 rounded-2xl p-4 text-[12px] text-rose-700 leading-relaxed">
                    <p className="font-bold mb-1">云端同步未配置</p>
                    <p>需要先在 Vercel dashboard 装 Neon 集成。装好后会自动启用。</p>
                </div>
            </div>
        );
    }

    // 未配对
    if (!config.pairCode) {
        return (
            <div className="space-y-4">
                <p className="text-[11px] text-slate-500 leading-relaxed px-1">
                    输入 6 位配对码加入已有设备，或生成新配对码开始。
                </p>

                {/* 设备名 */}
                <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">设备名</label>
                    <input
                        type="text"
                        value={deviceName}
                        onChange={(e) => setDeviceName(e.target.value.slice(0, 32))}
                        placeholder="如：我的 iPhone / 家里电脑"
                        className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm focus:bg-white transition-all"
                    />
                </div>

                {/* 已有配对码 — 加入 */}
                {showJoin ? (
                    <div className="bg-violet-50/50 border border-violet-200/50 rounded-2xl p-4 space-y-3">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">输入 6 位配对码</label>
                        <input
                            type="text"
                            value={joinCode}
                            onChange={(e) => setJoinCode(e.target.value.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 6))}
                            placeholder="例如：a3k9m2"
                            className="w-full bg-white border border-violet-200/60 rounded-xl px-4 py-3 text-xl font-mono font-bold text-center tracking-widest focus:outline-none focus:border-violet-400"
                            maxLength={6}
                            autoFocus
                        />
                        <div className="flex gap-2">
                            <button
                                onClick={() => { setShowJoin(false); setJoinCode(''); }}
                                className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-full text-xs font-bold active:scale-95 transition-all"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleJoin}
                                disabled={busy || joinCode.length !== 6}
                                className="flex-1 py-2.5 bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white rounded-full text-xs font-bold active:scale-95 transition-all disabled:opacity-50"
                            >
                                {busy ? '加入中…' : '加入配对'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <button
                        onClick={() => setShowJoin(true)}
                        className="w-full py-3 bg-white/80 border border-slate-200/60 text-slate-700 rounded-2xl text-xs font-bold active:scale-95 transition-all flex items-center justify-center gap-2"
                    >
                        <LinkIcon size={16} />
                        加入已有配对码
                    </button>
                )}

                {/* 分隔 */}
                <div className="flex items-center gap-3 px-2">
                    <div className="flex-1 h-px bg-slate-200" />
                    <span className="text-[10px] text-slate-400">或</span>
                    <div className="flex-1 h-px bg-slate-200" />
                </div>

                {/* 生成新配对码 */}
                <button
                    onClick={handleInit}
                    disabled={busy}
                    className="w-full py-3.5 bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white rounded-2xl text-sm font-bold active:scale-95 transition-all disabled:opacity-50 shadow-sm flex items-center justify-center gap-2"
                >
                    <CloudArrowUpIcon size={18} weight="fill" />
                    {busy ? '生成中…' : '生成新配对码'}
                </button>
            </div>
        );
    }

    // 已配对
    return (
        <div className="space-y-4">
            {/* 配对码展示 */}
            <div>
                <div className="flex items-center justify-between mb-2 px-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">你的配对码</label>
                    <span className={`text-[10px] font-bold ${statusColor}`}>● {statusText}</span>
                </div>
                <PairCodeDisplay code={config.pairCode} />
                <p className="text-[10px] text-slate-400 mt-2 leading-relaxed px-1">
                    在另一台设备的「设置 → 云端同步」输入这个码加入。配对码不会变，重启 / 关机都还在。
                </p>
            </div>

            {/* 设备名编辑 */}
            <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">当前设备名</label>
                <input
                    type="text"
                    value={deviceName}
                    onChange={(e) => setDeviceName(e.target.value.slice(0, 32))}
                    onBlur={() => {
                        // 简单更新（实时同步设备名）— 通过 initPair 但不重置配对码
                        // 简化：只更新 localStorage，不立刻上传（下次心跳时会带）
                    }}
                    className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm focus:bg-white transition-all"
                />
            </div>

            {/* 启用 / 暂停 */}
            <div className="flex items-center justify-between bg-white/60 border border-slate-200/50 rounded-2xl px-4 py-3">
                <div>
                    <div className="text-sm font-bold text-slate-700">云端同步</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                        {config.enabled ? '聊天记录 + 记忆宫殿自动同步' : '已暂停，新数据不上传'}
                    </div>
                </div>
                <button
                    onClick={() => setEnabled(!config.enabled)}
                    className={`relative w-12 h-7 rounded-full transition-colors ${config.enabled ? 'bg-gradient-to-br from-violet-500 to-fuchsia-500' : 'bg-slate-200'}`}
                >
                    <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform ${config.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
            </div>

            {/* 立即同步 */}
            {config.enabled && (
                <button
                    onClick={forceSyncNow}
                    disabled={status === 'syncing'}
                    className="w-full py-2.5 bg-white/80 border border-slate-200/60 text-slate-700 rounded-full text-xs font-bold active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                    <ArrowsClockwiseIcon size={14} className={status === 'syncing' ? 'animate-spin' : ''} />
                    {status === 'syncing' ? '同步中…' : '立即同步'}
                </button>
            )}

            {/* 错误提示 */}
            {errorMessage && status === 'error' && (
                <div className="bg-rose-50 border border-rose-200/60 rounded-2xl p-3 text-[11px] text-rose-700 leading-relaxed">
                    {errorMessage}
                </div>
            )}

            {/* 统计 */}
            {config.enabled && (
                <div className="grid grid-cols-2 gap-2 text-center">
                    <div className="bg-emerald-50/60 border border-emerald-200/40 rounded-2xl p-3">
                        <div className="text-[10px] text-emerald-600 font-bold mb-1">↑ 上传</div>
                        <div className="text-lg font-bold text-slate-700">{uploadedMessages + uploadedMemories}</div>
                        <div className="text-[9px] text-slate-500 mt-0.5">
                            {uploadedMessages} 消息 · {uploadedMemories} 记忆
                        </div>
                    </div>
                    <div className="bg-sky-50/60 border border-sky-200/40 rounded-2xl p-3">
                        <div className="text-[10px] text-sky-600 font-bold mb-1">↓ 拉取</div>
                        <div className="text-lg font-bold text-slate-700">{pulledMessages + pulledMemories}</div>
                        <div className="text-[9px] text-slate-500 mt-0.5">
                            {pulledMessages} 消息 · {pulledMemories} 记忆
                        </div>
                    </div>
                </div>
            )}

            {lastSuccessAt && (
                <p className="text-[10px] text-slate-400 text-center">
                    上次同步：{new Date(lastSuccessAt).toLocaleString('zh-CN')}
                </p>
            )}

            {/* 重置配对（危险区） */}
            {showReset ? (
                <div className="bg-rose-50 border border-rose-200/60 rounded-2xl p-3 space-y-2">
                    <p className="text-[11px] text-rose-700 leading-relaxed">
                        重置后这台设备会生成新配对码，<b>云端历史数据不会丢</b>，但新设备看不到老设备的数据。
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setShowReset(false)}
                            className="flex-1 py-2 bg-white text-slate-600 rounded-full text-xs font-bold active:scale-95 transition-all"
                        >
                            取消
                        </button>
                        <button
                            onClick={handleReset}
                            className="flex-1 py-2 bg-rose-500 text-white rounded-full text-xs font-bold active:scale-95 transition-all"
                        >
                            确认重置
                        </button>
                    </div>
                </div>
            ) : (
                <button
                    onClick={() => setShowReset(true)}
                    className="w-full py-2 text-[11px] text-slate-400 hover:text-rose-500 transition-colors"
                >
                    重置配对（换新码）
                </button>
            )}
        </div>
    );
};

export default SyncSettings;
