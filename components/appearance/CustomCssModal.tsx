// 暮色 2026-08-27 第三步：用户自定义聊天白框 CSS — 标准弹窗（替代原右侧抽屉）
//
// 形态：跟其他设置项一致的居中弹窗（fixed inset-0 + 黑遮罩 + 圆角卡片，max-w-lg / h-[80vh]）
//
// 内部布局：
//   - 顶部：下拉菜单（默认"选择预设"，列出 localStorage 里的所有预设）+ 删除按钮
//   - 中间：textarea（多行 CSS 输入）
//   - 底部：应用 / 保存为预设 / 清空 三个按钮
//
// 关键操作：
//   - 应用：把 textarea 当前内容立即注入 <style id="user-custom-css">（不写 localStorage）
//   - 保存为预设：弹小输入框起名，存到 localStorage + 自动选中 + 立即应用
//   - 清空：清空 textarea（不动 style 标签）
//   - 下拉选中某预设：把 CSS 加载到 textarea（不立即应用）
//   - 删除：confirm 后从 localStorage 删；若删的是激活预设则同时清激活 + 清空 style
//
// 共存：注入的 <style id="user-custom-css"> 由 syncUserCustomCssToDom 挂到 body 末尾，
// 排在 chatFineTuneCss / chatChromeCustomCss 之后，同优先级时 user CSS 总能盖过默认。
// 再用 !important 写选择器可确保跨主题改动也不被覆盖。

import React, { useEffect, useRef, useState } from 'react';
import {
  CustomCssPreset,
  loadPresets,
  savePresets,
  getActivePresetName,
  setActivePresetName,
  syncUserCustomCssToDom,
  findPreset,
} from '../../utils/customCssPresets';
import { Code, FloppyDisk, Trash, X, Check, CaretDown } from '@phosphor-icons/react';

interface Props {
  onClose: () => void;
}

const CustomCssModal: React.FC<Props> = ({ onClose }) => {
  const [presets, setPresetsState] = useState<CustomCssPreset[]>([]);
  const [activeName, setActiveNameState] = useState<string>('');
  // 当前下拉选中的预设名（与 activeName 解耦：activeName 是 localStorage 激活名，selectedName 是下拉 UI 选中）
  const [selectedName, setSelectedName] = useState<string>('');
  const [draft, setDraft] = useState<string>('');
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [savePromptError, setSavePromptError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 首次挂载：读 localStorage；默认选中激活预设（如果有），textarea 显示其 CSS
  useEffect(() => {
    const list = loadPresets();
    setPresetsState(list);
    const an = getActivePresetName();
    setActiveNameState(an);
    setSelectedName(an);
    const p = findPreset(list, an);
    setDraft(p?.css || '');
  }, []);

  // 应用：把当前 textarea 内容立即注入到 <style id="user-custom-css">（不写 localStorage）
  const handleApply = () => {
    syncUserCustomCssToDom(draft);
  };

  // 清空：只清 textarea，不动 style 标签（用户可能只是想重写）
  const handleClear = () => {
    setDraft('');
    setTimeout(() => textareaRef.current?.focus(), 30);
  };

  // 保存为预设：弹小输入框
  const openSavePrompt = () => {
    setSaveName('');
    setSavePromptError('');
    setSavePromptOpen(true);
  };

  // 真正保存
  const handleSavePreset = () => {
    const name = saveName.trim();
    if (!name) {
      setSavePromptError('名字不能为空');
      return;
    }
    const next = presets.slice();
    const idx = next.findIndex((p) => p.name === name);
    if (idx >= 0) {
      // 同名覆盖
      next[idx] = { name, css: draft };
    } else {
      next.push({ name, css: draft });
    }
    savePresets(next);
    setPresetsState(next);
    // 保存后自动选中新预设 + 设为激活 + 立即应用到 style 标签
    setSelectedName(name);
    setActivePresetName(name);
    setActiveNameState(name);
    syncUserCustomCssToDom(draft);
    setSavePromptOpen(false);
    setSaveName('');
  };

  // 下拉菜单选中某预设：把 CSS 加载到 textarea（不立即应用）
  const handleSelectPreset = (name: string) => {
    setSelectedName(name);
    if (!name) {
      setDraft('');
      return;
    }
    const p = findPreset(presets, name);
    setDraft(p?.css || '');
  };

  // 删除当前选中的预设（带 confirm）
  const handleDeleteSelected = () => {
    if (!selectedName) return;
    if (!window.confirm(`确定删除预设「${selectedName}」？`)) return;
    const name = selectedName;
    const next = presets.filter((p) => p.name !== name);
    savePresets(next);
    setPresetsState(next);
    // 删的是激活预设 → 清激活 + 清空 style 标签
    if (activeName === name) {
      setActivePresetName('');
      setActiveNameState('');
      syncUserCustomCssToDom('');
    }
    // 删除后清空选中 + textarea（避免 UI 显示已删预设的内容）
    setSelectedName('');
    setDraft('');
  };

  return (
    <>
      {/* 标准弹窗：fixed inset-0 + 黑遮罩 + 居中卡片（跟项目级 Modal 视觉一致，max-w 调大到 lg） */}
      <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 sm:p-6 animate-fade-in">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} />
        <div className="relative flex w-full max-w-lg flex-col overflow-hidden rounded-[1.5rem] border border-white/20 bg-white shadow-2xl animate-slide-up h-[80vh]">
          {/* 顶部 title bar */}
          <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-3">
            <div className="flex items-center gap-2">
              <Code size={16} weight="bold" className="text-primary" />
              <h2 className="text-sm font-bold text-slate-800">自定义 CSS</h2>
              {activeName && (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                  当前激活：{activeName}
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="关闭"
            >
              <X size={18} weight="bold" />
            </button>
          </div>

          {/* 内容区：下拉 + 删除 / textarea / 底部 3 按钮 */}
          <div className="flex flex-1 min-h-0 flex-col gap-3 px-5 py-4">
            {/* 顶部：下拉菜单 + 删除按钮 */}
            <div className="flex shrink-0 items-center gap-2">
              <div className="relative flex-1">
                <select
                  value={selectedName}
                  onChange={(e) => handleSelectPreset(e.target.value)}
                  className="block w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 py-2 pr-8 text-[12px] font-medium text-slate-700 outline-none focus:border-primary"
                >
                  <option value="">选择预设</option>
                  {presets.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                      {p.name === activeName ? '（当前激活）' : ''}
                    </option>
                  ))}
                </select>
                <CaretDown
                  size={12}
                  weight="bold"
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                />
              </div>
              <button
                onClick={handleDeleteSelected}
                disabled={!selectedName}
                title={selectedName ? `删除预设「${selectedName}」` : '请先在下拉菜单里选一个预设'}
                className="flex shrink-0 items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-600 transition-all hover:bg-rose-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash size={12} weight="bold" />
                删除
              </button>
            </div>

            {/* 中间：textarea */}
            <div className="flex-1 min-h-0">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                placeholder={`/* 在这里写 CSS，例如：\n.sully-chat-root .sully-bubble-ai { background: #fff5e6 !important; border-radius: 16px !important; }\n\n提示：用 !important 才能盖过默认样式 */`}
                className="block h-full w-full resize-none rounded-xl border border-slate-700 bg-slate-900 p-3 font-mono text-[12px] leading-relaxed text-slate-100 shadow-inner outline-none focus:border-primary"
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}
              />
            </div>

            {/* 底部：应用 / 保存为预设 / 清空 */}
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={handleApply}
                className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-primary px-3 py-2 text-[12px] font-bold text-white shadow-sm transition-all hover:opacity-90 active:scale-95"
              >
                <Code size={12} weight="bold" />
                应用
              </button>
              <button
                onClick={openSavePrompt}
                className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-700 transition-all hover:bg-slate-50 active:scale-95"
              >
                <FloppyDisk size={12} weight="bold" />
                保存为预设
              </button>
              <button
                onClick={handleClear}
                className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-700 transition-all hover:bg-slate-50 active:scale-95"
              >
                清空
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 保存为预设的小输入弹窗（z 更高，盖在主弹窗上） */}
      {savePromptOpen && (
        <div
          className="fixed inset-0 z-[160] flex items-center justify-center bg-black/40"
          onClick={() => setSavePromptOpen(false)}
        >
          <div
            className="w-80 rounded-2xl bg-white p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 text-[13px] font-semibold text-slate-800">保存为预设</div>
            <div className="mb-3 text-[11px] text-slate-500">
              起个名字，下次可以从下拉菜单直接选择。同名预设会被覆盖。
            </div>
            <input
              value={saveName}
              onChange={(e) => {
                setSaveName(e.target.value);
                setSavePromptError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSavePreset();
                if (e.key === 'Escape') setSavePromptOpen(false);
              }}
              placeholder="预设名"
              autoFocus
              className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-[12px] outline-none focus:border-primary"
            />
            {savePromptError && (
              <div className="mt-1.5 text-[10px] text-rose-600">{savePromptError}</div>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setSavePromptOpen(false)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                onClick={handleSavePreset}
                disabled={!saveName.trim()}
                className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-40"
              >
                <Check size={12} weight="bold" />
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default CustomCssModal;
