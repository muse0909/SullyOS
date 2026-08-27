// 暮色 2026-08-27 第四步：用户自定义聊天白框 CSS — inline 面板组件
//
// 跟之前的 CustomCssModal（弹窗）/ CustomCssDrawer（右侧抽屉）都不一样 ——
// 这是**直接渲染在父组件流式 section 里**的 inline 组件，没有弹层/抽屉/遮罩。
//
// 内容（按暮色 8-27 第四步需求）：
//   - 顶部：下拉菜单（默认"选择预设"，列出所有预设名）+ 删除按钮
//   - 中间：textarea（多行 CSS 输入）
//   - 底部：应用 / 保存为预设 / 清空 三个按钮
//
// 操作语义（跟之前一致）：
//   - 应用：把 textarea 当前内容立即注入 <style id="user-custom-css">（不写 localStorage）
//   - 保存为预设：弹小输入框起名，存到 localStorage + 自动选中 + 立即应用
//   - 清空：清空 textarea（不动 style 标签）
//   - 下拉选中某预设：把 CSS 加载到 textarea（不立即应用）
//   - 删除：confirm 后从 localStorage 删；若删的是激活预设则同时清激活 + 清空 style
//
// 共存：注入的 <style id="user-custom-css"> 由 syncUserCustomCssToDom 挂到 body 末尾，
// 排在 chatFineTuneCss / chatChromeCustomCss 之后，同优先级时 user CSS 总能盖过默认。

import React, { useEffect, useRef, useState } from 'react';
import {
  CustomCssPreset,
  ensureDefaultPreset,
  loadPresets,
  savePresets,
  getActivePresetName,
  setActivePresetName,
  syncUserCustomCssToDom,
  findPreset,
} from '../../utils/customCssPresets';
import { Code, FloppyDisk, Trash, Check, CaretDown } from '@phosphor-icons/react';

/** 暮色 2026-08-27 第四步：把"自定义 CSS"编辑器做成 inline 面板组件，
 *  没有外层弹窗/抽屉，直接在父 section 里渲染（紧邻"快速预设"）。 */
const CustomCssPanel: React.FC = () => {
  const [presets, setPresetsState] = useState<CustomCssPreset[]>([]);
  const [activeName, setActiveNameState] = useState<string>('');
  // 当前下拉选中的预设名（与 activeName 解耦：activeName 是 localStorage 激活名，selectedName 是下拉 UI 选中）
  const [selectedName, setSelectedName] = useState<string>('');
  const [draft, setDraft] = useState<string>('');
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [savePromptError, setSavePromptError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 首次挂载：预装示例（首次打开时） + 读 localStorage + 默认选中激活预设
  useEffect(() => {
    ensureDefaultPreset();
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

  // 清空：只清 textarea，不动 style 标签
  const handleClear = () => {
    setDraft('');
    setTimeout(() => textareaRef.current?.focus(), 30);
  };

  // 打开保存弹窗（小输入框）
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
    // 删除后清空选中 + textarea
    setSelectedName('');
    setDraft('');
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 顶部：下拉菜单 + 删除按钮 */}
      <div className="flex items-center gap-2">
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

      {/* 中间：textarea（多行 CSS 输入） */}
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        placeholder={`/* 在这里写 CSS，例如：\n.sully-chat-root .sully-bubble-ai { background: #fff5e6 !important; border-radius: 16px !important; }\n\n提示：用 !important 才能盖过默认样式 */`}
        className="block h-48 w-full resize-y rounded-xl border border-slate-700 bg-slate-900 p-3 font-mono text-[12px] leading-relaxed text-slate-100 shadow-inner outline-none focus:border-primary"
        style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}
      />

      {/* 底部：应用 / 保存为预设 / 清空 */}
      <div className="flex items-center gap-2">
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

      {/* 当前激活徽标：放最底下（顶部已被下拉菜单占据） */}
      {activeName && (
        <div className="text-[10px] text-slate-400">
          当前激活：<span className="font-medium text-emerald-600">{activeName}</span>
        </div>
      )}

      {/* 保存为预设的小输入弹窗（z 够高，盖在父 section 上） */}
      {savePromptOpen && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40"
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
    </div>
  );
};

export default CustomCssPanel;
