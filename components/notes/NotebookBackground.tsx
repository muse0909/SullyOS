// NotebookBackground — 私密记事手帐背景层（暮色 2026-07-17：用户自己上传）
// - 整页底层铺用户上传的图（base64 存 localStorage）
// - 默认提供 3 种 CSS 模拟背景（虚线信纸/点状网格/牛皮纸色），用户随时能上传自己的图替换
// - 右上角小齿轮按钮调"上传 / 清除 / 选默认"面板
// 暮色审美：上传图要压到 1080px + JPEG 80%，避免 localStorage 爆

import React, { useRef, useState } from 'react';
import { GearSix, Image as ImageIcon, X, Check } from '@phosphor-icons/react';

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

interface NotebookBackgroundProps {
    url: string | null;          // 用户上传的图（base64），null = 用 builtin
    builtin: BuiltinBg;          // 当前用的默认背景
    onChange: (next: { url: string | null; builtin: BuiltinBg }) => void;
    children: React.ReactNode;
}

const NotebookBackground: React.FC<NotebookBackgroundProps> = ({ url, builtin, onChange, children }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [showSettings, setShowSettings] = useState(false);

    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) return;
        try {
            const compressed = await compressImage(file);
            onChange({ url: compressed, builtin });
            setShowSettings(false);
        } catch (err) {
            console.error('[NotebookBackground] 压缩失败:', err);
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const chooseBuiltin = (key: BuiltinBg) => {
        onChange({ url: null, builtin: key });
    };

    const clearUploaded = () => {
        onChange({ url: null, builtin });
    };

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
                {/* 齿轮设置按钮（右上角） */}
                <button
                    onClick={() => setShowSettings(true)}
                    className="absolute top-3 right-3 z-20 w-9 h-9 rounded-full bg-white/70 backdrop-blur shadow-md flex items-center justify-center text-slate-500 hover:text-slate-700 active:scale-95 transition-all"
                    aria-label="背景设置"
                    title="背景设置"
                >
                    <GearSix size={16} />
                </button>

                {children}
            </div>

            {/* 设置面板（点空白处关闭） */}
            {showSettings && (
                <div
                    className="absolute inset-0 z-50 flex items-end justify-center"
                    onClick={() => setShowSettings(false)}
                >
                    <div className="absolute inset-0 bg-black/30" />
                    <div
                        className="relative w-full max-w-sm bg-white rounded-t-3xl p-5 animate-slide-up"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-base font-bold text-slate-800">背景设置</h3>
                            <button onClick={() => setShowSettings(false)} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400">
                                <X size={16} />
                            </button>
                        </div>

                        {/* 预设背景 */}
                        <div className="mb-4">
                            <div className="text-[11px] font-bold text-slate-500 mb-2">选默认风格</div>
                            <div className="grid grid-cols-3 gap-2">
                                {(Object.keys(BUILTIN_BG) as BuiltinBg[]).map((key) => {
                                    const isActive = !url && builtin === key;
                                    return (
                                        <button
                                            key={key}
                                            onClick={() => chooseBuiltin(key)}
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
                        </div>

                        {/* 上传 + 清除 */}
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
                                    onClick={clearUploaded}
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
                </div>
            )}
        </div>
    );
};

export default NotebookBackground;
