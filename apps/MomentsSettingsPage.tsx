// MomentsSettingsPage — 朋友圈设置页（暮色 2026-07-03 要求）
// 从 DiscoverPage 齿轮进入
// 字段对应 utils/momentsStorage.ts 的 MomentSettings
// 视觉：SullyOS 风格（马卡龙 + 居中胶囊 + Modal max-h-80vh 自适应）

import React, { useState, useEffect } from 'react';
import { CaretLeft, Sparkle, Eye, ArrowsLeftRight, ChartLineUp, Image as ImageIcon, MagicWand } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import {
  MomentSettings,
  getSettings,
  setSettings,
  getAllPosts,
  addPost,
  genPostId,
} from '../utils/momentsStorage';
import {
  generatePost as aiGeneratePost,
  publishPostAsChar,
  countTodayPostsByChar,
} from '../utils/momentsAI';
import Modal from '../components/os/Modal';

interface MomentsSettingsPageProps {
  onBack: () => void;
}

const MomentsSettingsPage: React.FC<MomentsSettingsPageProps> = ({ onBack }) => {
  const { characters, apiConfig, addToast, activeCharacterId } = useOS();
  const [settings, setLocalSettings] = useState<MomentSettings>(getSettings());
  const [generating, setGenerating] = useState(false);

  // 同步更新 storage
  const updateSetting = <K extends keyof MomentSettings>(key: K, value: MomentSettings[K]) => {
    setLocalSettings((prev) => {
      const next = { ...prev, [key]: value };
      setSettings({ [key]: value });
      return next;
    });
  };

  // 立即生成 N 条角色朋友圈
  const handleManualGenerate = async (count: number, selectedCharIds: string[]) => {
    if (selectedCharIds.length === 0) {
      addToast('请至少选择一个角色', 'warning');
      return;
    }
    if (!apiConfig.baseUrl || !apiConfig.apiKey) {
      addToast('请先配置 API', 'error');
      return;
    }
    setGenerating(true);
    try {
      const allPosts = getAllPosts();
      let successCount = 0;
      for (const charId of selectedCharIds) {
        const char = characters.find((c) => c.id === charId);
        if (!char) continue;
        // 按 maxPerDay 限制
        if (countTodayPostsByChar(charId, settings.maxPerDay) >= settings.maxPerDay) {
          addToast(`${char.name} 今日已发满，跳过`, 'info');
          continue;
        }
        for (let i = 0; i < count; i++) {
          const generated = await aiGeneratePost(char, apiConfig, {
            userName: '我',
            recentPosts: allPosts,
          }, settings);
          if (!generated) continue;
          // 发布到 localStorage
          publishPostAsChar(char, generated.content, generated.imagePrompt);
          successCount++;
        }
      }
      addToast(`已生成 ${successCount} 条动态`, 'success');
    } catch (e: any) {
      addToast('生成失败: ' + (e?.message || '未知错误'), 'error');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-[#ededed]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 bg-white border-b border-slate-200/60 shrink-0">
        <button
          onClick={onBack}
          className="w-9 h-9 flex items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 active:scale-95 transition-transform"
          aria-label="返回"
        >
          <CaretLeft size={20} weight="bold" />
        </button>
        <h1 className="text-base font-semibold text-slate-800 tracking-wide">朋友圈设置</h1>
        <div className="w-9 h-9" />
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* 自动化开关组 */}
        <SectionCard title="自动化" subtitle="AI 自动管理朋友圈" icon={<Sparkle size={14} weight="fill" className="text-amber-500" />}>
          <SettingToggle
            label="自动评论我的动态"
            desc="你发朋友圈后，AI 自动点赞 + 评论"
            checked={settings.autoCommentMine}
            onChange={(v) => updateSetting('autoCommentMine', v)}
          />
          <SettingToggle
            label="AI 主动发朋友圈"
            desc="开了：AI 在聊天中觉得合适时会自己发。关了：AI 完全不发朋友圈"
            checked={settings.autoPostByChar}
            onChange={(v) => updateSetting('autoPostByChar', v)}
          />
          <SettingToggle
            label="角色间自动互动"
            desc="AI 角色之间互相点赞、评论"
            checked={settings.autoCharInteraction}
            onChange={(v) => updateSetting('autoCharInteraction', v)}
          />
          <SettingToggle
            label="发完通知 AI"
            desc="你发朋友圈后提醒 AI 一次，让它决定要不要主动发消息跟你聊"
            checked={settings.notifyAIOnUserPost}
            onChange={(v) => updateSetting('notifyAIOnUserPost', v)}
          />
        </SectionCard>

        {/* 频率控制 */}
        <SectionCard title="频率控制" subtitle="每角色每日上限" icon={<ChartLineUp size={14} weight="fill" className="text-emerald-500" />}>
          <div className="px-1">
            <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
              <span>每天最多发几条</span>
              <span className="font-bold text-emerald-600">{settings.maxPerDay} 条</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={settings.maxPerDay}
              onChange={(e) => updateSetting('maxPerDay', Number(e.target.value))}
              className="w-full accent-emerald-500"
            />
            <div className="text-[10px] text-slate-400 mt-1">设为 0 完全不发；100 基本不限制</div>
          </div>
        </SectionCard>

        {/* 生图设置 — 暮色 2026-07-15：简化为单一 toggle，生图只走 OpenAI 兼容 */}
        <SectionCard title="配图" subtitle="AI 发朋友圈时是否配图" icon={<ImageIcon size={14} weight="fill" className="text-pink-500" />}>
          <SettingToggle
            label="AI 自主配图"
            desc="开启后，AI 根据朋友圈内容自己决定要不要加图；关闭后强制不配图"
            checked={settings.aiCanUseImage}
            onChange={(v) => updateSetting('aiCanUseImage', v)}
          />
        </SectionCard>

        {/* 手动生成 */}
        <SectionCard title="手动生成" subtitle="指定角色发朋友圈" icon={<MagicWand size={14} weight="fill" className="text-violet-500" />}>
          <ManualGenerator
            characters={characters.map((c) => ({ id: c.id, name: c.name, avatar: c.avatar }))}
            onGenerate={handleManualGenerate}
            generating={generating}
          />
        </SectionCard>
      </div>
    </div>
  );
};

// === Section 卡片 ===
const SectionCard: React.FC<{
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, subtitle, icon, children }) => (
  <div className="bg-white rounded-2xl shadow-sm border border-slate-100/80 overflow-hidden">
    <div className="px-4 py-3 flex items-center gap-2 border-b border-slate-50">
      {icon}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-700">{title}</div>
        {subtitle && <div className="text-[10px] text-slate-400 mt-0.5">{subtitle}</div>}
      </div>
    </div>
    <div className="py-2">{children}</div>
  </div>
);

// === 开关行 ===
const SettingToggle: React.FC<{
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}> = ({ label, desc, checked, onChange }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className="w-full px-4 py-2.5 flex items-center gap-3 active:bg-slate-50 transition-colors text-left"
  >
    <div className="flex-1 min-w-0">
      <div className="text-[13px] text-slate-700 font-medium">{label}</div>
      {desc && <div className="text-[10px] text-slate-400 mt-0.5 leading-snug">{desc}</div>}
    </div>
    {/* iOS 风格 toggle */}
    <div
      className={`relative shrink-0 w-10 h-6 rounded-full transition-colors ${
        checked ? 'bg-emerald-500' : 'bg-slate-200'
      }`}
    >
      <div
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </div>
  </button>
);

// === 手动生成 ===
const ManualGenerator: React.FC<{
  characters: { id: string; name: string; avatar?: string }[];
  onGenerate: (count: number, selectedCharIds: string[]) => void;
  generating: boolean;
}> = ({ characters, onGenerate, generating }) => {
  const [count, setCount] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="px-4 py-2 space-y-3">
      <div>
        <div className="flex items-center justify-between text-xs text-slate-600 mb-1.5">
          <span>每人生成篇数</span>
          <span className="font-bold text-violet-600">{count} 篇</span>
        </div>
        <input
          type="range"
          min={1}
          max={5}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          className="w-full accent-violet-500"
        />
      </div>

      <div>
        <div className="text-xs text-slate-600 mb-1.5">选择角色（可多选）</div>
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {characters.length === 0 ? (
            <div className="text-[11px] text-slate-400 py-2 text-center">还没有角色</div>
          ) : (
            characters.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c.id)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                  selected.has(c.id) ? 'bg-violet-50' : 'hover:bg-slate-50'
                }`}
              >
                <div
                  className={`w-3.5 h-3.5 rounded border-2 shrink-0 ${
                    selected.has(c.id) ? 'bg-violet-500 border-violet-500' : 'border-slate-300'
                  } flex items-center justify-center`}
                >
                  {selected.has(c.id) && (
                    <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-white" fill="none">
                      <path d="M2 6l3 3 5-6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                {c.avatar ? (
                  <img src={c.avatar} alt="" className="w-5 h-5 rounded-full object-cover" />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-slate-200" />
                )}
                <span className="text-[12px] text-slate-700">{c.name}</span>
              </button>
            ))
          )}
        </div>
      </div>

      <button
        type="button"
        disabled={generating || selected.size === 0}
        onClick={() => onGenerate(count, Array.from(selected))}
        className="w-full py-3 bg-slate-800 text-white text-sm font-bold rounded-full disabled:opacity-40 active:scale-95 transition-transform"
      >
        {generating ? '生成中...' : '开始生成'}
      </button>
    </div>
  );
};

export default MomentsSettingsPage;
