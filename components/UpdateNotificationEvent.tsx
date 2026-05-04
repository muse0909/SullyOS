/**
 * UpdateNotificationEvent.tsx
 * 版本更新强制提醒弹窗 (2026.5)
 *
 * 所有尚未确认过本次弹窗的用户，打开后都会被强制接到一次，
 * 点击"查看更新"后会跳转到使用帮助 App 的对应更新日志页。
 */

import React from 'react';
import { useOS } from '../context/OSContext';
import { AppID } from '../types';

// 历史 key —— 保留, 让老用户的"已看过"状态延续到本月新弹窗判断里
export const UPDATE_NOTIFICATION_KEY = 'sullyos_update_2026_04_seen';
// 本月 key —— 新弹窗的"已看过"标记
export const UPDATE_NOTIFICATION_KEY_2026_05 = 'sullyos_update_2026_05_seen';

export const FAQ_TARGET_SECTION_KEY = 'sullyos_faq_target_section';
export const CHANGELOG_2026_04 = 'changelog-2026-04';
export const CHANGELOG_2026_05 = 'changelog-2026-05';

export const shouldShowUpdateNotification = (): boolean => {
    try {
        return !localStorage.getItem(UPDATE_NOTIFICATION_KEY_2026_05);
    } catch {
        return false;
    }
};

interface UpdateNotificationPopupProps {
    onClose: () => void;
}

export const UpdateNotificationPopup: React.FC<UpdateNotificationPopupProps> = ({ onClose }) => {
    const { openApp } = useOS();

    const handleView = () => {
        try {
            localStorage.setItem(UPDATE_NOTIFICATION_KEY_2026_05, Date.now().toString());
            sessionStorage.setItem(FAQ_TARGET_SECTION_KEY, CHANGELOG_2026_05);
        } catch { /* ignore */ }
        openApp(AppID.FAQ);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-5 animate-fade-in">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />
            <div className="relative w-full max-w-sm bg-white/95 backdrop-blur-xl rounded-[2.5rem] shadow-2xl border border-white/30 overflow-hidden animate-slide-up">
                <div className="pt-7 pb-3 px-6 text-center">
                    <img
                        src="https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2728.png"
                        alt="update"
                        className="w-10 h-10 mx-auto mb-2"
                    />
                    <h2 className="text-lg font-extrabold text-slate-800">版本更新提醒</h2>
                    <p className="text-[11px] text-slate-400 mt-1">2026 年 5 月 · 麦当劳 MCP & HTML 模块</p>
                </div>

                <div className="px-6 pb-4 space-y-3">
                    <div className="bg-gradient-to-br from-amber-50 to-rose-50 border border-amber-100 rounded-2xl p-4">
                        <p className="text-[13px] text-slate-700 leading-relaxed">
                            本次更新支持<strong className="text-emerald-700">GitHub 数据备份</strong>，<strong className="text-sky-600">音乐 App 弱化梯子依赖</strong>；新增了<strong className="text-amber-700">麦当劳 MCP</strong>、<strong className="text-rose-600">聊天 HTML 模块</strong>与<strong className="text-indigo-600">写歌生成音乐</strong>，并修复了世界书 / 桌面小组件 / 群聊的若干 bug。
                        </p>
                        <p className="text-[12px] text-slate-500 leading-relaxed mt-2">
                            为了顺利开启新功能，请先看一眼本次更新说明。你之后也可以在"使用帮助 → 更新日志"中随时重读。
                        </p>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3">
                        <p className="text-[12px] font-bold text-amber-700 text-center">
                            点击下方按钮查看本次更新说明
                        </p>
                    </div>
                </div>

                <div className="px-6 pb-7 pt-2">
                    <button
                        onClick={handleView}
                        className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-rose-500 text-white font-bold rounded-2xl shadow-lg shadow-amber-200 active:scale-95 transition-transform text-sm"
                    >
                        查看 2026 年 5 月更新内容
                    </button>
                </div>
            </div>
        </div>
    );
};

interface UpdateNotificationControllerProps {
    onClose: () => void;
}

export const UpdateNotificationController: React.FC<UpdateNotificationControllerProps> = ({ onClose }) => {
    return <UpdateNotificationPopup onClose={onClose} />;
};
