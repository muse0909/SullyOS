
import React from 'react';
import { createPortal } from 'react-dom';
import { X } from '@phosphor-icons/react';

interface ModalProps {
    isOpen: boolean;
    title: string;
    onClose: () => void;
    children: React.ReactNode;
    footer?: React.ReactNode;
    /**
     * 默认 true（暮色 2026-07-03 拍板）：卡片 max-h-[80vh] 自适应
     *   高度 = 内容高度（底部不留空）；超过 80vh 时 body 内部滚动
     * 传 false：卡片 h-[80vh] 固定（少数特殊场景才用，比如需要占满屏幕的复杂表单）
     */
    adaptiveHeight?: boolean;
    /**
     * 暮色 2026-08-04：z-index 优先级（默认 100）
     *   - 嵌套在 z-[110]+ 的浮层内时，要传 120+ 才能盖过宿主面板
     *   - 例子：ApiQuickFloat 面板是 z-[110]，内部 Modal 要传 120
     */
    zIndex?: number;
    /**
     * 暮色 9-20:是否在 modal 卡片右上角显示 X 关闭按钮(默认 false)
     *   - true 时点 X = 调 onClose(跟点遮罩一致)
     *   - 之前 modal 只能点遮罩/底部"关闭"按钮关,部分场景用户找不到关的地方
     *   - 触发场景:开场生成失败 modal 等「需要明确关闭入口」的弹窗
     */
    showCloseButton?: boolean;
}

const Modal: React.FC<ModalProps> = ({ isOpen, title, onClose, children, footer, adaptiveHeight = true, zIndex = 100, showCloseButton = false }) => {
    if (!isOpen) return null;

    const cardHeightClass = adaptiveHeight ? 'max-h-[80vh]' : 'h-[80vh]';

    // 暮色 2026-08-07：createPortal 到 body 逃出 backdrop-filter 父级
    //   之前 fixed inset-0 会被 backdrop-filter 父级"吃掉"（Chromium 完整实现 spec），
    //   导致弹窗 z-index 跟父级同级、被盖住、点击穿透到父级
    //   跟 2026-06-28 buff-popup-portal-fix 同款坑，但这次是项目级 Modal 组件
    return createPortal(
        <div className="fixed inset-0 flex items-center justify-center p-6 animate-fade-in" style={{ zIndex }}>
            <div className="absolute inset-0 bg-black/40" onClick={onClose} />
            <div className={`relative w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl border border-white/20 overflow-hidden animate-slide-up ${cardHeightClass} flex flex-col`}>
                {/* 暮色 9-20:右上角 X 关闭按钮(可选)— 点 X = 调 onClose,跟点遮罩一致 */}
                {showCloseButton && (
                    <button
                        onClick={onClose}
                        className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center active:scale-90 transition-all z-10"
                        style={{ background: 'rgba(0,0,0,0.05)', color: '#64748b' }}
                        title="关闭"
                    >
                        <X size={16} weight="bold" />
                    </button>
                )}
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
        </div>,
        document.body
    );
};

export default Modal;
