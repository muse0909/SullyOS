import React, { useEffect, useRef } from 'react';
import { X } from '@phosphor-icons/react';

interface FullScreenInputProps {
    isOpen: boolean;
    title?: string;
    value: string;
    onChange: (v: string) => void;
    onClose: () => void;     // 关闭（不保存）
    onConfirm: () => void;   // 完成（保存回原输入框）
    placeholder?: string;
    height?: string;         // 默认 '85vh'
    confirmText?: string;    // 默认 '完成'
    maxLength?: number;
    onSend?: () => void;     // 可选：发送快捷键
    sendButtonText?: string; // 可选：发送按钮文字
}

/**
 * 全屏输入组件
 * 样式参考神经链接的"编辑记忆"弹窗（圆角 + 白底 + 浅灰内容区），
 * 但放大到 80%+ 屏高，左右占满，专注写作。
 *
 * 用法：
 *   const [showFull, setShowFull] = useState(false);
 *   const [tempInput, setTempInput] = useState('');
 *
 *   const openFull = () => { setTempInput(input); setShowFull(true); };
 *   const confirmFull = () => { setInput(tempInput); setShowFull(false); };
 *
 *   <button onClick={openFull}><CornersOut /></button>
 *   <FullScreenInput
 *     isOpen={showFull}
 *     title="聊天输入"
 *     value={tempInput}
 *     onChange={setTempInput}
 *     onClose={() => setShowFull(false)}
 *     onConfirm={confirmFull}
 *     placeholder="输入消息..."
 *   />
 *
 * 底部按钮（取消/发送/完成）已移除——关闭靠顶部 X，点外部，或 Esc 键；
 * 保存靠 Ctrl/Cmd+Enter（或关闭弹窗时由 onClose 调用方决定是否回写）。
 */
const FullScreenInput: React.FC<FullScreenInputProps> = ({
    isOpen,
    title = '编辑',
    value,
    onChange,
    onClose,
    onConfirm,
    placeholder = '请输入...',
    height = '85vh',
    confirmText = '完成',
    maxLength,
    onSend,
    sendButtonText = '发送',
}) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // 打开时自动聚焦 + 光标移到末尾
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

    // 键盘快捷键
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
                return;
            }
            // Ctrl/Cmd + Enter = 完成（保存）
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onConfirm();
                return;
            }
            // Ctrl/Cmd + Shift + Enter = 发送（如果有 onSend）
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter' && onSend) {
                e.preventDefault();
                onSend();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose, onConfirm, onSend]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-[300] bg-black/40 backdrop-blur-sm flex items-end justify-center animate-fade-in"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
        >
            <div
                className="w-full bg-white rounded-t-3xl shadow-2xl flex flex-col overflow-hidden"
                style={{ height }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* 顶部：标题 + 关闭 */}
                <div className="h-14 px-4 flex items-center justify-between border-b border-slate-100 shrink-0">
                    <span className="text-base font-bold text-slate-700 truncate">{title}</span>
                    <button
                        onClick={onClose}
                        className="w-9 h-9 rounded-full hover:bg-slate-100 active:bg-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors shrink-0"
                        aria-label="关闭"
                    >
                        <X className="w-5 h-5" weight="bold" />
                    </button>
                </div>

                {/* 主体：textarea */}
                <textarea
                    ref={textareaRef}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    maxLength={maxLength}
                    className="flex-1 w-full px-6 py-5 text-base leading-relaxed resize-none focus:outline-none bg-slate-50 text-slate-800 placeholder:text-slate-400 no-scrollbar"
                />
            </div>
        </div>
    );
};

export default FullScreenInput;
