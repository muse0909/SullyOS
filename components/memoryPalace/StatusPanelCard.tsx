/**
 * 状态面板卡片 — 记忆宫殿顶部展示 + 手动编辑入口
 *
 * 暮色 8-25:在原便利贴位置(已下线)放新状态面板,沿用便利贴米黄视觉风格。
 *   展示态:单卡片 #fffbeb + #fde68a 边框,内容 = 拼好的 5 槽位文本,右上角 [编辑]
 *   编辑态:5 个 input(每个槽位一个),底部 [保存] [取消]
 *   空态:单卡片 "暂无状态记录",不隐藏整个区域
 *
 * 数据:读 getStatusPanel() 写 setStatusPanel()(直接覆盖,跟 LLM 增量更新 applyStatusUpdate 区分)
 * 注入:formatter.ts:108 下次调用时会从 localStorage 读到最新值,无需通知
 */

import React, { useState, useEffect } from 'react';
import { PushPin, PencilSimple, Check, X } from '@phosphor-icons/react';
import {
    getStatusPanel,
    setStatusPanel,
    STATUS_SLOTS,
    type UserStatusPanel,
    type StatusSlot,
} from '../../utils/memoryPalace/statusPanel';

const SLOT_LABELS: Record<StatusSlot, string> = {
    location: '所在地',
    health: '身体',
    schedule: '在忙',
    mood: '情绪',
    reminder: '约定',
};

/** 把 5 槽位拼成 "[所在地] xxx | [身体] xxx | ..." 一行(全空返 '') */
function buildLine(panel: UserStatusPanel): string {
    const parts: string[] = [];
    for (const slot of STATUS_SLOTS) {
        const v = panel[slot];
        if (typeof v === 'string' && v.length > 0) {
            parts.push(`[${SLOT_LABELS[slot]}] ${v}`);
        }
    }
    return parts.join(' | ');
}

const StatusPanelCard: React.FC = () => {
    const [panel, setPanel] = useState<UserStatusPanel>({});
    const [editing, setEditing] = useState(false);
    // 草稿:5 个槽位每个一个 string(空字符串 = 该槽位清除)
    const [draft, setDraft] = useState<Record<StatusSlot, string>>({
        location: '', health: '', schedule: '', mood: '', reminder: '',
    });

    // 初次加载 + 跨 tab 同步
    useEffect(() => {
        const load = () => setPanel(getStatusPanel());
        load();
        const onStorage = (e: StorageEvent) => {
            if (e.key === 'user_status_panel') load();
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    const line = buildLine(panel);
    const isEmpty = line.length === 0;

    // 进入编辑:把当前值塞进草稿
    const startEdit = () => {
        setDraft({
            location: panel.location ?? '',
            health: panel.health ?? '',
            schedule: panel.schedule ?? '',
            mood: panel.mood ?? '',
            reminder: panel.reminder ?? '',
        });
        setEditing(true);
    };

    // 保存:空字符串视作清除(调用 setStatusPanel 会过滤掉),所以这里不需要额外处理
    const save = () => {
        setStatusPanel(draft);
        setPanel(getStatusPanel());
        setEditing(false);
    };

    const cancel = () => {
        setEditing(false);
    };

    // 卡片样式(沿用原便利贴: #fffbeb 背景 + #fde68a 边框 + borderRadius 10)
    const cardStyle: React.CSSProperties = {
        marginBottom: 16,
        padding: '10px 12px',
        borderRadius: 10,
        border: '1px solid #fde68a',
        background: '#fffbeb',
    };

    if (editing) {
        return (
            <div style={cardStyle}>
                {/* 标题 */}
                <div style={{
                    fontSize: 14, fontWeight: 600, marginBottom: 10,
                    display: 'flex', alignItems: 'center', gap: 6, color: '#1f2937',
                }}>
                    <PushPin size={14} weight="regular" />
                    <span>当前状态面板(编辑中)</span>
                </div>

                {/* 5 槽位 input */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {STATUS_SLOTS.map(slot => (
                        <div key={slot} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{
                                fontSize: 12, color: '#92400e', fontWeight: 600,
                                minWidth: 40, flexShrink: 0,
                            }}>
                                {SLOT_LABELS[slot]}
                            </span>
                            <input
                                type="text"
                                value={draft[slot]}
                                onChange={e => setDraft(prev => ({ ...prev, [slot]: e.target.value }))}
                                placeholder={`(空 = 清除该槽位)`}
                                style={{
                                    flex: 1, minWidth: 0,
                                    fontSize: 13, lineHeight: 1.5, color: '#1f2937',
                                    padding: '6px 10px', borderRadius: 6,
                                    border: '1px solid #fde68a', background: 'white',
                                    outline: 'none',
                                }}
                                onFocus={e => { e.currentTarget.style.borderColor = '#f59e0b'; }}
                                onBlur={e => { e.currentTarget.style.borderColor = '#fde68a'; }}
                            />
                        </div>
                    ))}
                </div>

                {/* 底部按钮 */}
                <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                    <button
                        onClick={cancel}
                        style={{
                            padding: '4px 12px', borderRadius: 6,
                            border: '1px solid #fde68a', background: 'white',
                            fontSize: 11, color: '#92400e', cursor: 'pointer',
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                        }}
                    >
                        <X size={11} weight="bold" />
                        取消
                    </button>
                    <button
                        onClick={save}
                        style={{
                            padding: '4px 12px', borderRadius: 6,
                            border: '1px solid #f59e0b', background: '#f59e0b',
                            fontSize: 11, color: 'white', fontWeight: 600, cursor: 'pointer',
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                        }}
                    >
                        <Check size={11} weight="bold" />
                        保存
                    </button>
                </div>
            </div>
        );
    }

    // 展示态 / 空态
    return (
        <div
            onClick={isEmpty ? startEdit : undefined}
            style={{
                ...cardStyle,
                cursor: isEmpty ? 'pointer' : 'default',
            }}
        >
            <div style={{
                fontSize: 14, fontWeight: 600, marginBottom: isEmpty ? 0 : 6,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, color: '#1f2937',
            }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <PushPin size={14} weight="regular" />
                    <span>当前状态面板</span>
                </span>
                {!isEmpty && (
                    <button
                        onClick={startEdit}
                        style={{
                            padding: '3px 8px', borderRadius: 6,
                            border: '1px solid #fde68a', background: 'white',
                            fontSize: 10, color: '#92400e', cursor: 'pointer',
                            display: 'inline-flex', alignItems: 'center', gap: 3,
                        }}
                    >
                        <PencilSimple size={10} weight="bold" />
                        编辑
                    </button>
                )}
            </div>
            {!isEmpty && (
                <div style={{ fontSize: 13, lineHeight: 1.5, color: '#1f2937' }}>
                    {line}
                </div>
            )}
            {isEmpty && (
                <div style={{ fontSize: 12, color: '#92400e', marginTop: 4 }}>
                    暂无状态记录 · 点击此处编辑
                </div>
            )}
        </div>
    );
};

export default StatusPanelCard;
