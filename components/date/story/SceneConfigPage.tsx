/**
 * 场景配置中间页 — 暮色 8-25 第五步
 *
 * 用户从列表页点场景模板卡后进这个中间页:
 *   1. 备选前提(单选 radio,3-5 个)
 *   2. 自定义前提输入框(选了就预填可改,可清空自写)
 *   3. 文风(默认填模板的 writingStyle,可点开编辑)
 *   4. 底部"开剧场"按钮 → 建 Entry + 跳到 StoryTheaterSession
 *
 * 暮色 8-25 第五步明确:
 *   - 不直接跳 session,先到这页选/改前提 + 文风
 *   - writingStyle 写入 Entry(持久化),buildRPSystemPrompt 读它做风格指令
 *   - 改后的文风以用户确认的为准
 */

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Sparkle, PencilSimple, Check, X } from '@phosphor-icons/react';
import { useOS } from '../../../context/OSContext';
import { createEntryFromSceneTemplate } from '../../../utils/storyTheater';
import { DB } from '../../../utils/db';
import { SELECT_THEME } from './storyTheme';
import { WRITING_STYLE_PRESETS } from './writingStylePresets';
import type { StorySceneTemplate } from '../../../types';

interface Props {
    template: StorySceneTemplate;
    onCancel: () => void;             // 返回列表页
    onConfirm: (entryId: string) => void;  // 建 Entry 完成,跳 session
}

const SceneConfigPage: React.FC<Props> = ({ template, onCancel, onConfirm }) => {
    const { activeCharacterId, addToast } = useOS();
    const [selectedIdx, setSelectedIdx] = useState<number>(0);  // 默认选第一个备选
    const [customPremise, setCustomPremise] = useState<string>('');
    // 暮色 8-26 简化:中间页只保留"前提 + 文风"两件事;其他(RP 角色指令/叙事参数/生成参数/解锁提示词/状态栏/API)
    // 全部移到 RP 设置里(全局默认配置)。单剧场可在 session 内 ⚙ 弹窗里覆盖。
    const [writingStyle, setWritingStyle] = useState<string>(template.writingStyle);
    // 暮色 8-26:RP 设置里"整个剧场的默认 API"在新建时继承(可被单剧场 ⚙ 弹窗覆盖)
    const [apiConfigId, setApiConfigId] = useState<string | undefined>(undefined);
    const [submitting, setSubmitting] = useState(false);

    // 暮色 8-26:文风 + 默认 API 从全局默认继承(其他字段全部走 RP 设置的全局默认,运行时由 buildRPMessageArray merge)
    useEffect(() => {
        void DB.getRPGlobalDefaults().then(defaults => {
            if (!defaults) return;
            if (defaults.writingStyle) setWritingStyle(defaults.writingStyle);
            if (defaults.apiConfigId) setApiConfigId(defaults.apiConfigId);
        });
    }, []);

    // 选备选时自动填自定义输入框(用户可改/可清空)
    useEffect(() => {
        if (selectedIdx >= 0 && selectedIdx < template.premiseOptions.length) {
            setCustomPremise(template.premiseOptions[selectedIdx]);
        }
    }, [selectedIdx, template.premiseOptions]);

    if (!activeCharacterId) {
        return (
            <div className="h-full w-full flex items-center justify-center px-6" style={{ background: SELECT_THEME.pageBg }}>
                <div className="text-center">
                    <div className="text-[14px] mb-3" style={{ color: SELECT_THEME.title }}>请先在聊天页选一个角色</div>
                    <button onClick={onCancel} className="px-4 py-2 rounded-xl text-[12px] font-bold" style={{ background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}>返回</button>
                </div>
            </div>
        );
    }

    const handleConfirm = async () => {
        if (submitting) return;
        if (!customPremise.trim()) {
            addToast?.('前提不能为空', 'error');
            return;
        }
        // 暮色 8-26:文风空 = 默认质感(不注入文风指令),合法
        setSubmitting(true);
        try {
            const { DB } = await import('../../../utils/db');
            const entry = createEntryFromSceneTemplate({
                template,
                characterId: activeCharacterId,
                premise: customPremise.trim(),
                writingStyle: writingStyle.trim(),
                apiConfigId,  // 暮色 8-26:RP 设置里的默认 API 继承过来
                // 暮色 8-26 简化:其他字段(RP 角色指令/叙事参数/生成参数/解锁提示词/状态栏)不写到 Entry,
                // session 进站时从 RPGlobalDefaults 注入;单剧场在 ⚙ 弹窗覆盖时再写到 Entry。
            });
            await DB.saveStoryTheater(entry);
            onConfirm(entry.id);
        } catch (e: any) {
            addToast?.(`开剧场失败: ${e?.message || e}`, 'error');
            setSubmitting(false);
        }
    };

    // 暮色 8-26 反馈:之前 fixed inset-0 z-50 仍然露列表页 + 顶部裁切。
    // 根因:PhoneShell 背景层 transform: scale(1.1) + App 容器 contain: layout style paint
    //       会创建 fixed 定位的 containing block,fixed 困在 PhoneShell 内部,跟列表页同 stacking context。
    // 修法:用 React Portal 挂到 document.body,逃出所有 stacking/transform/contain 影响,
    //      portal 出去后 fixed 真正相对 viewport,顶部 paddingTop 从 env(safe-area-inset-top) 开始。
    return createPortal(
        <div className="fixed inset-0 z-50 flex flex-col font-light" style={{ background: SELECT_THEME.pageBg }}>
            <div className="absolute inset-0 pointer-events-none opacity-70" style={{ backgroundImage: SELECT_THEME.stars }} />

            {/* 顶栏 — portal 出去后从 viewport 顶部 + 安全区开始,不再用 var(--safe-top) 双重叠加 */}
            <div className="relative z-10 shrink-0" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}>
                <div className="relative flex items-center justify-center px-5 pt-2">
                    <button onClick={onCancel} className="absolute left-4 w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-all"
                            style={{ color: '#8f7bb5', background: 'rgba(255,255,255,0.6)', boxShadow: '0 2px 8px rgba(150,120,200,0.15)' }}>
                        <ArrowLeft size={18} weight="bold" />
                    </button>
                    <div className="text-center">
                        <h1 className="text-[22px] tracking-[0.14em]" style={{ fontFamily: `'Noto Serif SC',serif`, color: SELECT_THEME.title, textShadow: `0 2px 18px ${SELECT_THEME.titleShadow}` }}>配置剧场</h1>
                        <div className="flex items-center justify-center gap-2 mt-1.5">
                            <span className="h-px w-10" style={{ background: `linear-gradient(90deg,transparent,${SELECT_THEME.line})` }} />
                            <span className="text-[9px] tracking-[0.4em] font-bold" style={{ color: 'rgba(150,120,190,0.75)' }}>✦ STORY SETUP ✦</span>
                            <span className="h-px w-10" style={{ background: `linear-gradient(270deg,transparent,${SELECT_THEME.line})` }} />
                        </div>
                    </div>
                </div>
            </div>

            {/* 主体滚动 */}
            <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-5 py-4">
                {/* 场景信息卡 */}
                <div className="rounded-2xl px-4 py-4 mb-4" style={{ background: 'rgba(255,255,255,0.6)', border: `1px solid ${SELECT_THEME.cardBorder}` }}>
                    <div className="flex items-center gap-3 mb-2">
                        <span className="text-[28px]">{template.emoji}</span>
                        <div className="flex-1 min-w-0">
                            <div className="text-[16px] font-bold" style={{ color: '#4a3a6a' }}>{template.name}</div>
                            <div className="text-[11px] mt-0.5" style={{ color: 'rgba(150,120,190,0.7)' }}>{template.description}</div>
                        </div>
                    </div>
                    {template.tags.length > 0 && (
                        <div className="flex gap-1.5 flex-wrap">
                            {template.tags.map(tag => (
                                <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(167,139,250,0.12)', color: '#715d99' }}>#{tag}</span>
                            ))}
                        </div>
                    )}
                </div>

                {/* 1. 备选前提(单选) */}
                <SectionTitle title="选个前情提要" subtitle="CHOOSE PREMISE" />
                <div className="space-y-2 mb-4">
                    {template.premiseOptions.map((p, idx) => (
                        <button
                            key={idx}
                            onClick={() => setSelectedIdx(idx)}
                            className="w-full text-left rounded-2xl px-3.5 py-3 active:scale-[0.98] transition-all"
                            style={{
                                background: selectedIdx === idx ? 'linear-gradient(135deg,rgba(167,139,250,0.18),rgba(124,58,237,0.08))' : 'rgba(255,255,255,0.55)',
                                border: selectedIdx === idx ? '1.5px solid #a78bfa' : '1px solid rgba(170,140,210,0.3)',
                                boxShadow: selectedIdx === idx ? '0 4px 14px rgba(167,139,250,0.2)' : 'none',
                            }}
                        >
                            <div className="flex items-start gap-2.5">
                                <div
                                    className="w-4 h-4 rounded-full flex-shrink-0 mt-0.5 flex items-center justify-center"
                                    style={{
                                        border: selectedIdx === idx ? '5px solid #7c3aed' : '1.5px solid rgba(150,120,190,0.4)',
                                        background: 'white',
                                    }}
                                />
                                <div className="text-[12px] leading-relaxed flex-1" style={{ color: '#4a3a6a' }}>{p}</div>
                            </div>
                        </button>
                    ))}
                </div>

                {/* 2. 自定义前提输入框 */}
                <SectionTitle title="或自己改写前提" subtitle="CUSTOM PREMISE" />
                <textarea
                    value={customPremise}
                    onChange={e => {
                        setCustomPremise(e.target.value);
                        // 改了说明用户自写了,清掉选中态
                        if (selectedIdx !== -1) setSelectedIdx(-1);
                    }}
                    placeholder="想怎么开始?背景设定、剧情起点、你想怎么玩…"
                    rows={3}
                    className="w-full px-3.5 py-2.5 rounded-2xl text-[12.5px] resize-none focus:outline-none leading-relaxed"
                    style={{ background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(170,140,210,0.3)', color: '#1f2937' }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#a78bfa'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = 'rgba(170,140,210,0.3)'; }}
                />

                {/* 3. 文风 */}
                <SectionTitle title="文风" subtitle="WRITING STYLE" />
                {/* 暮色 8-26 改:placeholder 写明不选=默认质感(不注入文风指令,主模型自己拿捏) */}

                {/* 暮色 8-26:6 个文风预设卡片(默认质感 8-26 删掉 — 文风输入框 placeholder 直接写"默认质感"说明)
                    - 点选 → 填入文风输入框
                    - 再点一次 → 取消,输入框清空
                    - 也可以不选,直接手写
                    - 都不选 = 用默认质感(空 prompt,不注入任何文风指令) */}
                <div className="grid grid-cols-3 gap-1.5 mb-2">
                    {WRITING_STYLE_PRESETS.filter(p => p.id !== 'default').map(p => {
                        const isActive = writingStyle.trim() === p.prompt && p.prompt !== '';
                        return (
                            <button
                                key={p.id}
                                onClick={() => {
                                    if (isActive) {
                                        setWritingStyle('');
                                    } else {
                                        setWritingStyle(p.prompt);
                                        setEditingStyle(false);
                                    }
                                }}
                                className="rounded-xl px-2 py-2 active:scale-95 transition-all text-left"
                                style={{
                                    background: isActive
                                        ? 'linear-gradient(135deg,rgba(167,139,250,0.22),rgba(124,58,237,0.12))'
                                        : 'rgba(255,255,255,0.55)',
                                    border: isActive
                                        ? '1.5px solid #a78bfa'
                                        : '1px solid rgba(170,140,210,0.25)',
                                    boxShadow: isActive ? '0 2px 8px rgba(167,139,250,0.2)' : 'none',
                                }}
                                title={p.description}
                            >
                                <div className="text-[11.5px] font-bold" style={{ color: isActive ? '#715d99' : '#4a3a6a' }}>{p.label}</div>
                                <div className="text-[9px] mt-0.5 truncate" style={{ color: 'rgba(150,120,190,0.7)' }}>{p.description}</div>
                            </button>
                        );
                    })}
                </div>
                {/* 暮色 8-26 简化:文风输入框始终显示(不再编辑态切换)— 6 预设点选填入,空 = 默认质感 */}
                <textarea
                    value={writingStyle}
                    onChange={e => setWritingStyle(e.target.value)}
                    rows={2}
                    className="w-full px-3.5 py-2.5 rounded-2xl text-[12.5px] resize-none focus:outline-none leading-relaxed"
                    style={{ background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(170,140,210,0.3)', color: '#1f2937' }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#a78bfa'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = 'rgba(170,140,210,0.3)'; }}
                    placeholder="不选预设 = 默认质感(不注入文风指令,主模型自己拿捏)。也可手写或点上面 6 个预设。"
                />

                {/* 暮色 8-26 简化:角色指令 / 叙事参数 / 生成参数 / 作者注释 / 状态栏 / 解锁提示词 / API
                    全部移到 RP 设置(齿轮里)→ 默认配置。中间页只剩场景信息 + 备选前提 + 自定义前提 + 文风。 */}
            </div>

            {/* 底部"开剧场"按钮 — portal 出去后用 env(safe-area-inset-bottom) 直接读 viewport */}
            <div className="relative z-10 shrink-0 px-5 pb-5 pt-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}>
                <button
                    onClick={handleConfirm}
                    disabled={submitting || !customPremise.trim()}
                    className="w-full py-3 rounded-2xl text-[14px] font-bold flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-40"
                    style={{
                        background: 'linear-gradient(135deg,#a78bfa,#7c3aed)',
                        color: 'white',
                        boxShadow: '0 6px 20px rgba(124,58,237,0.3)',
                    }}
                >
                    {submitting ? '开剧场中...' : '开剧场 →'}
                </button>
            </div>
        </div>,
        document.body
    );
};

const SectionTitle: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => (
    <div className="mb-2 mt-1">
        <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold tracking-[0.3em] uppercase" style={{ color: 'rgba(150,120,190,0.75)' }}>{subtitle}</span>
            <span className="h-px flex-1 max-w-[3rem]" style={{ background: 'linear-gradient(90deg,rgba(150,120,190,0.5),transparent)' }} />
        </div>
        <div className="text-[13px] font-bold tracking-wider mt-1" style={{ color: '#4a3a6a' }}>{title}</div>
    </div>
);

/* 暮色 8-26:OptionCardRow 已不在 SceneConfigPage 用(4 叙事参数移到 RP 设置),留 RPApiSettingsPage 用自己的版本 */

const inputStyle: React.CSSProperties = {
    background: 'white',
    border: '1px solid rgba(170,140,210,0.3)',
    color: '#1f2937',
};

export default SceneConfigPage;
