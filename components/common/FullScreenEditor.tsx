import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, GearSix, X, Trash, Image as ImageIcon } from '@phosphor-icons/react';

interface FullScreenEditorProps {
    isOpen: boolean;
    title?: string;
    value: string;
    onChange: (v: string) => void;
    onClose: () => void;     // 取消
    onConfirm: () => void;   // 返回 = 保存
    placeholder?: string;
    onSend?: () => void;
    sendButtonText?: string;
    confirmText?: string;
}

/**
 * 全屏编辑器 v2
 * 整个全屏（不再弹窗），顶部左返回 + 中标题 + 右设置，
 * 右上点开是设置面板（预览 + 背景图 + 透明度 + 字体大小 + 字体颜色）。
 *
 * 行为：
 * - 左上 ← 返回 = 关闭并保存（onConfirm）
 * - 右上 ⚙ 设置 = 抽屉式设置面板
 * - 取消 = 关闭不保存
 * - 完成 / 发送 = 关闭并保存
 */
const FullScreenEditor: React.FC<FullScreenEditorProps> = ({
    isOpen,
    title = '编辑',
    value,
    onChange,
    onClose,
    onConfirm,
    placeholder = '请输入...',
    onSend,
    sendButtonText = '发送',
    confirmText = '完成',
}) => {
    const [showSettings, setShowSettings] = useState(false);
    // 设置（每次打开重置，暂不持久化；后续按需加 IndexedDB）
    const [bgImage, setBgImage] = useState<string | null>(null);
    const [bgOverlayOpacity, setBgOverlayOpacity] = useState(85); // 0-100, 遮罩不透明度（值越大背景越被遮盖）
    const [fontSize, setFontSize] = useState(16);
    const [fontColor, setFontColor] = useState('#1e293b');

    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // 打开时自动聚焦 + 光标到末尾
    useEffect(() => {
        if (isOpen && textareaRef.current) {
            setTimeout(() => {
                const ta = textareaRef.current;
                if (!ta) return;
                ta.focus();
                const len = ta.value.length;
                try { ta.setSelectionRange(len, len); } catch { /* ignore */ }
            }, 80);
        }
    }, [isOpen]);

    // Esc 处理
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                if (showSettings) {
                    setShowSettings(false);
                } else {
                    onConfirm();
                }
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onConfirm();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter' && onSend) {
                e.preventDefault();
                onSend();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onConfirm, onSend, showSettings]);

    if (!isOpen) return null;

    // 用 Portal 挂到 body，绕过父容器的 transform/overflow 干扰
    // （iOS PWA 模式下 App.tsx 用了 translateZ(0)，会让 fixed 变 absolute）
    return createPortal(
        <div
            className="fixed inset-0 z-[9999] flex flex-col"
            style={{
                backgroundColor: '#f8fafc',
                paddingTop: 'env(safe-area-inset-top, 0px)',
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
        >
            {/* 背景图（如果有） */}
            {bgImage && (
                <>
                    <div
                        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
                        style={{ backgroundImage: `url(${bgImage})` }}
                    />
                    <div
                        className="absolute inset-0 bg-slate-50"
                        style={{ opacity: bgOverlayOpacity / 100 }}
                    />
                </>
            )}

            {/* 内容层 */}
            <div className="relative z-10 flex-1 flex flex-col">
                {/* 顶部：左返回 + 中标题 + 右设置 */}
                <div className="h-14 px-3 flex items-center justify-between shrink-0">
                    <button
                        onClick={onConfirm}
                        className="w-9 h-9 rounded-full hover:bg-slate-200/60 flex items-center justify-center text-slate-500 hover:text-slate-800 transition-colors active:scale-90"
                        title="返回并保存"
                        aria-label="返回并保存"
                    >
                        <ArrowLeft className="w-5 h-5" weight="bold" />
                    </button>
                    <span className="text-sm font-medium text-slate-500 truncate px-3">{title}</span>
                    <button
                        onClick={() => setShowSettings(true)}
                        className="w-9 h-9 rounded-full hover:bg-slate-200/60 flex items-center justify-center text-slate-500 hover:text-slate-800 transition-colors active:scale-90"
                        title="设置"
                        aria-label="设置"
                    >
                        <GearSix className="w-5 h-5" weight="bold" />
                    </button>
                </div>

                {/* 主体：textarea（无边框） */}
                <textarea
                    ref={textareaRef}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    style={{ color: fontColor, fontSize: `${fontSize}px` }}
                    className="flex-1 w-full px-6 py-4 bg-transparent resize-none focus:outline-none no-scrollbar leading-relaxed placeholder:text-slate-400"
                />

                {/* 底部：按钮（无边框，居中） */}
                <div className="h-16 px-4 flex items-center justify-center gap-3 shrink-0">
                    <button
                        onClick={onClose}
                        className="px-6 h-11 bg-white/70 backdrop-blur text-slate-500 font-medium rounded-full active:scale-95 transition-transform"
                    >
                        取消
                    </button>
                    {onSend && (
                        <button
                            onClick={onSend}
                            disabled={!value.trim()}
                            className="px-7 h-11 bg-white/70 backdrop-blur text-primary font-medium rounded-full active:scale-95 transition-transform disabled:opacity-40"
                        >
                            {sendButtonText}
                        </button>
                    )}
                    <button
                        onClick={onConfirm}
                        className="px-8 h-11 bg-primary text-white font-medium rounded-full shadow-lg active:scale-95 transition-transform"
                    >
                        {confirmText}
                    </button>
                </div>
            </div>

            {/* 设置抽屉（右侧滑出） */}
            {showSettings && (
                <div
                    className="fixed inset-0 z-[400] bg-black/30"
                    onClick={() => setShowSettings(false)}
                >
                    <div
                        className="absolute right-0 top-0 bottom-0 w-[88%] max-w-md bg-white shadow-2xl flex flex-col animate-slide-in-right"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* 抽屉顶部 */}
                        <div className="h-14 px-4 flex items-center justify-between border-b border-slate-100 shrink-0">
                            <span className="text-base font-bold text-slate-700">全屏输入设置</span>
                            <button
                                onClick={() => setShowSettings(false)}
                                className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 active:scale-90"
                            >
                                <X className="w-5 h-5" weight="bold" />
                            </button>
                        </div>

                        {/* 预览（固定顶部） */}
                        <div className="p-4 border-b border-slate-100 shrink-0">
                            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">预览</div>
                            <div
                                className="rounded-xl p-4 min-h-[80px] relative overflow-hidden border border-slate-200"
                                style={{
                                    backgroundColor: '#f8fafc',
                                    backgroundImage: bgImage ? `url(${bgImage})` : undefined,
                                    backgroundSize: 'cover',
                                    backgroundPosition: 'center',
                                }}
                            >
                                {bgImage && (
                                    <div
                                        className="absolute inset-0 bg-slate-50"
                                        style={{ opacity: bgOverlayOpacity / 100 }}
                                    />
                                )}
                                <p
                                    style={{
                                        color: fontColor,
                                        fontSize: `${fontSize}px`,
                                        position: 'relative',
                                    }}
                                    className="leading-relaxed whitespace-pre-wrap break-words"
                                >
                                    {value || placeholder || '在这里写点什么...'}
                                </p>
                            </div>
                        </div>

                        {/* 设置项 */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-5">
                            {/* 背景图上传 */}
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">背景图</label>
                                <div className="flex items-center gap-2">
                                    {bgImage ? (
                                        <img src={bgImage} className="w-14 h-14 rounded-lg object-cover border border-slate-200 shrink-0" />
                                    ) : (
                                        <div className="w-14 h-14 rounded-lg border-2 border-dashed border-slate-200 flex items-center justify-center text-slate-300 shrink-0">
                                            <ImageIcon className="w-5 h-5" />
                                        </div>
                                    )}
                                    <label className="flex-1 h-11 border border-slate-200 rounded-lg flex items-center justify-center text-sm text-slate-500 cursor-pointer hover:border-slate-300 hover:bg-slate-50 transition-colors active:scale-95">
                                        <input
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (file) {
                                                    const reader = new FileReader();
                                                    reader.onload = () => setBgImage(reader.result as string);
                                                    reader.readAsDataURL(file);
                                                }
                                            }}
                                        />
                                        {bgImage ? '更换图片' : '点击上传'}
                                    </label>
                                    {bgImage && (
                                        <button
                                            onClick={() => setBgImage(null)}
                                            className="w-11 h-11 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center shrink-0 active:scale-90"
                                            title="删除背景图"
                                        >
                                            <Trash className="w-4 h-4" weight="bold" />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* 背景遮罩透明度 */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">背景遮罩（数字越小背景越清晰）</label>
                                    <span className="text-sm font-bold text-slate-700">{100 - bgOverlayOpacity}%</span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={bgOverlayOpacity}
                                    onChange={(e) => setBgOverlayOpacity(Number(e.target.value))}
                                    className="w-full accent-primary"
                                />
                            </div>

                            {/* 字体大小 */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">字体大小</label>
                                    <span className="text-sm font-bold text-slate-700">{fontSize}px</span>
                                </div>
                                <input
                                    type="range"
                                    min="12"
                                    max="32"
                                    value={fontSize}
                                    onChange={(e) => setFontSize(Number(e.target.value))}
                                    className="w-full accent-primary"
                                />
                            </div>

                            {/* 字体颜色 */}
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">字体颜色</label>
                                <div className="flex items-center gap-2 mb-3">
                                    <input
                                        type="color"
                                        value={fontColor}
                                        onChange={(e) => setFontColor(e.target.value)}
                                        className="w-12 h-12 rounded-lg border border-slate-200 cursor-pointer p-1 bg-white shrink-0"
                                    />
                                    <input
                                        type="text"
                                        value={fontColor}
                                        onChange={(e) => setFontColor(e.target.value)}
                                        className="flex-1 h-12 bg-slate-50 border border-slate-200 rounded-lg px-3 text-sm font-mono focus:outline-none focus:border-primary"
                                    />
                                </div>
                                <div className="flex gap-2 flex-wrap">
                                    {['#0f172a', '#1e293b', '#475569', '#7c2d12', '#7e22ce', '#0e7490', '#15803d', '#9f1239', '#000000', '#ffffff'].map(c => (
                                        <button
                                            key={c}
                                            onClick={() => setFontColor(c)}
                                            className={`w-8 h-8 rounded-full border-2 transition-all active:scale-90 ${fontColor === c ? 'border-primary scale-110' : 'border-slate-200'}`}
                                            style={{ backgroundColor: c }}
                                            title={c}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>,
        document.body
    );
};

export default FullScreenEditor;
