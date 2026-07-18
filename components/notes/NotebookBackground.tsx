// NotebookBackground — 私密记事手帐背景层（暮色 2026-07-17：纯背景层，不含设置面板）
// 暮色 2026-07-17 改：之前这组件含齿轮+设置面板，现在拆分：
//   - 本组件：纯背景层 + 上传 API
//   - 设置面板（含背景设置 + 搜索）由 PrivateNotesPage 渲染，从右侧 70% 拉出
// 背景存储：base64 存 localStorage
// 暮色审美：上传图要压到 1080px + JPEG 80%，避免 localStorage 爆

import React, { useEffect, useState } from 'react';
import { Check, Image as ImageIcon, X } from '@phosphor-icons/react';

const STORAGE_KEY = 'sullyos_notebook_bg';
const STORAGE_DEFAULT_KEY = 'sullyos_notebook_bg_default';

export type BuiltinBg = 'cream-paper' | 'dot-grid' | 'kraft';

const BUILTIN_BG: Record<BuiltinBg, { label: string; css: React.CSSProperties }> = {
    'cream-paper': {
        label: '奶油信纸',
        css: {
            backgroundColor: '#f3eee5',
            backgroundImage: 'repeating-linear-gradient(0deg, transparent 0px, transparent 31px, rgba(180, 160, 120, 0.18) 31px, rgba(180, 160, 120, 0.18) 32px)',
        },
    },
    'dot-grid': {
        label: '点状网格',
        css: {
            backgroundColor: '#fafaf7',
            backgroundImage: 'radial-gradient(circle, #d4d4d4 1px, transparent 1px)',
            backgroundSize: '20px 20px',
        },
    },
    'kraft': {
        label: '牛皮纸',
        css: {
            backgroundColor: '#d4a574',
            backgroundImage: 'radial-gradient(circle at 20% 30%, rgba(255,255,255,0.1) 0%, transparent 50%), radial-gradient(circle at 80% 70%, rgba(0,0,0,0.05) 0%, transparent 50%)',
        },
    },
};

export const getStoredNotebookBg = (): { url: string | null; builtin: BuiltinBg | null } => {
    try {
        const url = localStorage.getItem(STORAGE_KEY);
        const builtin = localStorage.getItem(STORAGE_DEFAULT_KEY) as BuiltinBg | null;
        return { url, builtin };
    } catch {
        return { url: null, builtin: null };
    }
};

export const setStoredNotebookBg = (url: string | null) => {
    try {
        if (url) localStorage.setItem(STORAGE_KEY, url);
        else localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
        console.warn('[NotebookBackground] 存储失败:', e);
    }
};

export const setStoredNotebookBuiltin = (key: BuiltinBg) => {
    try {
        localStorage.setItem(STORAGE_DEFAULT_KEY, key);
    } catch (e) {
        console.warn('[NotebookBackground] 存储 builtin 失败:', e);
    }
};

// 压缩图片到 1080px 宽 + JPEG 80%
const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const maxW = 1080;
                const ratio = Math.min(1, maxW / img.width);
                const w = Math.round(img.width * ratio);
                const h = Math.round(img.height * ratio);
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                if (!ctx) return reject(new Error('canvas 不可用'));
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.onerror = reject;
            img.src = e.target?.result as string;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
};

// 背景区选择器（小卡片网格），给设置面板用
export const BgStylePicker: React.FC<{
    url: string | null;
    builtin: BuiltinBg;
    onChange: (next: { url: string | null; builtin: BuiltinBg }) => void;
    onClose?: () => void;
}> = ({ url, builtin, onChange, onClose }) => {
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) return;
        try {
            const compressed = await compressImage(file);
            onChange({ url: compressed, builtin });
        } catch (err) {
            console.error('[BgStylePicker] 压缩失败:', err);
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    return (
        <div>
            <div className="text-[11px] font-bold text-slate-500 mb-2 uppercase tracking-widest">选默认风格</div>
            <div className="grid grid-cols-3 gap-2 mb-4">
                {(Object.keys(BUILTIN_BG) as BuiltinBg[]).map((key) => {
                    const isActive = !url && builtin === key;
                    return (
                        <button
                            key={key}
                            onClick={() => onChange({ url: null, builtin: key })}
                            className="relative h-16 rounded-xl border-2 overflow-hidden transition-all"
                            style={{
                                ...BUILTIN_BG[key].css,
                                borderColor: isActive ? '#10b981' : 'rgba(0,0,0,0.06)',
                            }}
                        >
                            {isActive && (
                                <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center">
                                    <Check size={10} weight="bold" />
                                </div>
                            )}
                            <div className="absolute bottom-1 left-1 text-[9px] font-bold text-slate-700 bg-white/80 px-1.5 py-0.5 rounded">
                                {BUILTIN_BG[key].label}
                            </div>
                        </button>
                    );
                })}
            </div>

            <div className="flex gap-2">
                <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 py-3 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-md active:scale-95 transition-transform"
                >
                    <ImageIcon size={16} weight="fill" />
                    上传自己的图
                </button>
                {url && (
                    <button
                        onClick={() => onChange({ url: null, builtin })}
                        className="px-4 py-3 rounded-2xl bg-rose-50 text-rose-500 text-xs font-bold hover:bg-rose-100"
                    >
                        清除
                    </button>
                )}
            </div>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFile}
                className="hidden"
            />
        </div>
    );
};

interface NotebookBackgroundProps {
    url: string | null;
    builtin: BuiltinBg;
    children: React.ReactNode;
}

const NotebookBackground: React.FC<NotebookBackgroundProps> = ({ url, builtin, children }) => {
    return (
        <div className="absolute inset-0 flex flex-col">
            {/* 背景层 */}
            {url ? (
                <div
                    className="absolute inset-0 bg-cover bg-center"
                    style={{ backgroundImage: `url(${url})` }}
                />
            ) : (
                <div className="absolute inset-0" style={BUILTIN_BG[builtin].css} />
            )}

            {/* 内容层 */}
            <div className="relative flex-1 flex flex-col">
                {children}
            </div>
        </div>
    );
};

export default NotebookBackground;
