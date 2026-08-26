/**
 * 快捷键 modal — 暮色 8-26 17:00
 *
 * 暮色原话:"之前见面里陪伴模式里有个(快捷键)... 接到这边来吧"
 *
 * 功能:
 *   - 用户自建快捷输入短语列表(共享 localStorage,跨剧场)
 *   - 点列表项 → 插入到输入框当前光标位置
 *   - "+ 新建" → 弹输入框让用户填短语内容 + 保存
 *   - 长按/× 删
 *
 * 数据存 localStorage key 'rp_quick_phrases_v1' — 全剧场景共享一份
 */

import React, { useEffect, useRef, useState } from 'react';
import { Plus, Trash } from '@phosphor-icons/react';
import { createPortal } from 'react-dom';

const STORAGE_KEY = 'rp_quick_phrases_v1';

export interface QuickPhrase {
    id: string;
    text: string;
    createdAt: number;
}

function loadPhrases(): QuickPhrase[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(p => p && typeof p.text === 'string' && p.text.trim());
    } catch {
        return [];
    }
}

function savePhrases(phrases: QuickPhrase[]) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(phrases));
    } catch {
        // 忽略 quota 错误
    }
}

function generateId(): string {
    return 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

interface Props {
    onClose: () => void;
    onSelect: (text: string) => void;  // 暮色 8-26 17:00:选短语时插入到输入框
}

const QuickPhrasesModal: React.FC<Props> = ({ onClose, onSelect }) => {
    const [phrases, setPhrases] = useState<QuickPhrase[]>([]);
    const [newText, setNewText] = useState<string>('');
    const [creating, setCreating] = useState<boolean>(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setPhrases(loadPhrases());
    }, []);

    useEffect(() => {
        if (creating && inputRef.current) {
            inputRef.current.focus();
        }
    }, [creating]);

    const handleSave = () => {
        const text = newText.trim();
        if (!text) return;
        const next: QuickPhrase[] = [
            ...phrases,
            { id: generateId(), text, createdAt: Date.now() },
        ];
        setPhrases(next);
        savePhrases(next);
        setNewText('');
        setCreating(false);
    };

    const handleDelete = (id: string) => {
        const next = phrases.filter(p => p.id !== id);
        setPhrases(next);
        savePhrases(next);
    };

    const handleSelect = (text: string) => {
        onSelect(text);
        onClose();
    };

    return createPortal(
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4"
            style={{ background: 'rgba(15,23,42,0.55)' }}
            onClick={onClose}
        >
            <div
                onClick={e => e.stopPropagation()}
                className="w-full max-w-md flex flex-col"
                style={{
                    background: 'linear-gradient(160deg,#ffffff 0%,#f7f2fb 100%)',
                    borderRadius: 24,
                    border: '1px solid rgba(170,140,210,0.3)',
                    boxShadow: '0 20px 50px -20px rgba(150,120,200,0.4)',
                    maxHeight: '70vh',
                }}
            >
                {/* 顶渐变线 */}
                <div className="h-[2px] w-full" style={{ background: 'linear-gradient(90deg,transparent,#a78bfa,#7c3aed,transparent)' }} />
                {/* 标题 */}
                <div className="px-6 pt-5 pb-3 text-center">
                    <div className="text-[10px] tracking-[0.3em] uppercase font-bold" style={{ color: '#7c3aed' }}>QUICK PHRASES</div>
                    <h3 className="text-[18px] font-bold mt-1" style={{ color: '#4a3a6a' }}>快捷键</h3>
                </div>

                {/* 列表 */}
                <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-3 space-y-2">
                    {phrases.length === 0 ? (
                        <div className="text-center text-[12px] py-8" style={{ color: 'rgba(150,120,190,0.7)' }}>
                            还没有快捷键,点下方"+ 新建"加一个
                        </div>
                    ) : (
                        phrases.map(p => (
                            <div
                                key={p.id}
                                className="flex items-center gap-2 rounded-xl px-3 py-2.5 active:scale-[0.98] transition-all"
                                style={{ background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(170,140,210,0.25)' }}
                            >
                                <button
                                    onClick={() => handleSelect(p.text)}
                                    className="flex-1 text-left text-[12.5px] leading-relaxed"
                                    style={{ color: '#4a3a6a' }}
                                >
                                    {p.text}
                                </button>
                                <button
                                    onClick={() => handleDelete(p.id)}
                                    className="w-7 h-7 rounded-lg flex items-center justify-center active:scale-90"
                                    style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}
                                    title="删除"
                                >
                                    <Trash size={11} weight="fill" />
                                </button>
                            </div>
                        ))
                    )}
                </div>

                {/* 新建输入 */}
                {creating && (
                    <div className="px-5 pb-3 flex gap-2">
                        <input
                            ref={inputRef}
                            type="text"
                            value={newText}
                            onChange={e => setNewText(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') handleSave();
                                if (e.key === 'Escape') { setCreating(false); setNewText(''); }
                            }}
                            placeholder="输入快捷短语内容..."
                            className="flex-1 px-3 py-2 rounded-xl text-[12.5px] focus:outline-none"
                            style={{ background: 'white', border: '1px solid rgba(170,140,210,0.3)', color: '#1f2937' }}
                        />
                        <button
                            onClick={handleSave}
                            className="px-3 rounded-xl text-[12px] font-bold"
                            style={{ background: 'linear-gradient(135deg,#a78bfa,#7c3aed)', color: 'white' }}
                        >保存</button>
                    </div>
                )}

                {/* 底部按钮:关闭 + 新建 */}
                <div className="flex gap-2 px-5 py-4 border-t" style={{ borderColor: 'rgba(170,140,210,0.2)' }}>
                    <button
                        onClick={onClose}
                        className="flex-1 py-2.5 rounded-xl text-[13px] font-bold"
                        style={{ background: 'rgba(150,150,150,0.1)', color: '#666' }}
                    >关闭</button>
                    {!creating && (
                        <button
                            onClick={() => setCreating(true)}
                            className="flex-1 py-2.5 rounded-xl text-[13px] font-bold flex items-center justify-center gap-1.5"
                            style={{ background: 'linear-gradient(135deg,#a78bfa,#7c3aed)', color: 'white' }}
                        >
                            <Plus size={13} weight="bold" />新建
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default QuickPhrasesModal;
