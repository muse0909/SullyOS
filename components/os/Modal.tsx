
import React from 'react';

interface ModalProps {
    isOpen: boolean;
    title: string;
    onClose: () => void;
    children: React.ReactNode;
    footer?: React.ReactNode;
    /**
     * 默认 false: 卡片 h-[80vh] 固定 80vh（内容少时底部留白，内容多时滚动）
     * true: 卡片 max-h-[80vh] 自适应（内容少时卡片小，**底部不留空**）
     * 适用：消息操作/快捷切换类（内容少）；固定高度类（朋友圈/日程/详情）保持默认
     */
    adaptiveHeight?: boolean;
}

const Modal: React.FC<ModalProps> = ({ isOpen, title, onClose, children, footer, adaptiveHeight = false }) => {
    if (!isOpen) return null;

    const cardHeightClass = adaptiveHeight ? 'max-h-[80vh]' : 'h-[80vh]';

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 animate-fade-in">
            <div className="absolute inset-0 bg-black/40" onClick={onClose} />
            <div className={`relative w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl border border-white/20 overflow-hidden animate-slide-up ${cardHeightClass} flex flex-col`}>
                <div className="px-6 pt-6 pb-2 shrink-0">
                    <h3 className="text-lg font-bold text-slate-800 text-center">{title}</h3>
                </div>
                <div className="px-6 py-4 flex-1 min-h-0 overflow-y-auto no-scrollbar">
                    {children}
                </div>
                {footer ? (
                    <div className="px-6 pb-6 flex gap-3 shrink-0">
                        {footer}
                    </div>
                ) : (
                    <div className="px-6 pb-6 shrink-0">
                        <button
                            onClick={onClose}
                            className="w-full py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl active:scale-95 transition-transform"
                        >
                            关闭
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Modal;
