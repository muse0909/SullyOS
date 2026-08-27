// 暮色 2026-08-27 第二步：用户自定义聊天白框 CSS — UI 弹窗（从外观 App 右侧抽屉滑出）
//
// 包含：
// - 多行代码输入框（textarea，等宽字体 + 深色底浅色字，方便看代码）
// - 「实时预览」按钮：把当前 textarea 里的 CSS 注入 <style id="user-custom-css"> 但不写 localStorage
// - 「保存为预设」按钮：弹小输入框起名字，存到 localStorage custom_css_presets 数组
// - 下方已保存预设列表：每项「应用 / 编辑 / 删除」三个按钮
// - 顶部「清空激活」按钮：把激活预设名字移除 + 清空 <style> 内容
//
// 「应用」= 把对应 CSS 塞进 <style> + 记录激活名到 localStorage
// 「编辑」= 把 CSS 加载到 textarea（不动激活 / 不写库）—— 用户改完再「实时预览」看效果，再「保存为预设」覆盖同名
// 「删除」= 从 localStorage 数组里删，如果删的是激活的则同时清空激活名 + <style>
//
// 共存：注入的 <style id="user-custom-css"> 是单独的 style 标签，排在 chatFineTuneCss 和 chatChromeCustomCss 之后，
// 浏览器同优先级后写胜——所以用户 CSS 总能盖过默认可视化设置和 chatChromeCustomCss。
// 再用 !important 写选择器可确保跨主题改动也不被覆盖。

import React, { useEffect, useRef, useState } from 'react';
import {
  CustomCssPreset,
  DEFAULT_PRESET_CSS,
  DEFAULT_PRESET_NAME,
  bootstrapUserCustomCss,
  findPreset,
  getActivePresetName,
  loadPresets,
  savePresets,
  setActivePresetName,
  syncUserCustomCssToDom,
} from '../../utils/customCssPresets';
import { Code, FloppyDisk, Play, Trash, PencilSimple, X, Check, ArrowCounterClockwise, Sparkle } from '@phosphor-icons/react';

interface Props {
  onClose: () => void;
}

const CustomCssDrawer: React.FC<Props> = ({ onClose }) => {
  const [presets, setPresetsState] = useState<CustomCssPreset[]>([]);
  const [activeName, setActiveNameState] = useState<string>('');
  const [draft, setDraft] = useState<string>('');
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [editingExisting, setEditingExisting] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 首次挂载：读 localStorage，同步注入到 <style>，把激活预设的 CSS 加载到 textarea
  useEffect(() => {
    const list = loadPresets();
    setPresetsState(list);
    const an = getActivePresetName();
    setActiveNameState(an);
    const p = findPreset(list, an);
    setDraft(p?.css || '');
    // 注入到 <style id="user-custom-css"> —— 防御性兜底（启动加载已做过，这里再确保一次）
    bootstrapUserCustomCss();
  }, []);

  const refresh = () => {
    const list = loadPresets();
    setPresetsState(list);
  };

  const handlePreview = () => {
    syncUserCustomCssToDom(draft);
  };

  const handleSavePreset = () => {
    const name = saveName.trim();
    if (!name) return;
    const next = presets.slice();
    const idx = next.findIndex((p) => p.name === name);
    if (idx >= 0) {
      next[idx] = { name, css: draft };
    } else {
      next.push({ name, css: draft });
    }
    savePresets(next);
    setActivePresetName(name);
    setActiveNameState(name);
    syncUserCustomCssToDom(draft);
    setPresetsState(next);
    setSavePromptOpen(false);
    setSaveName('');
    setEditingExisting(null);
  };

  const handleApply = (p: CustomCssPreset) => {
    setActivePresetName(p.name);
    setActiveNameState(p.name);
    setDraft(p.css);
    syncUserCustomCssToDom(p.css);
  };

  const handleEdit = (p: CustomCssPreset) => {
    setDraft(p.css);
    // 滚动到顶部让用户看到
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const handleDelete = (p: CustomCssPreset) => {
    if (!window.confirm(`确定删除预设「${p.name}」？`)) return;
    const next = presets.filter((x) => x.name !== p.name);
    savePresets(next);
    if (activeName === p.name) {
      setActivePresetName('');
      setActiveNameState('');
      syncUserCustomCssToDom('');
    }
    setPresetsState(next);
  };

  const handleClearActive = () => {
    if (!window.confirm('清空当前激活的 CSS？聊天页会回到无自定义状态（预设列表保留）。')) return;
    setActivePresetName('');
    setActiveNameState('');
    setDraft('');
    syncUserCustomCssToDom('');
  };

  const handleLoadDefault = () => {
    setDraft(DEFAULT_PRESET_CSS);
  };

  const openSavePrompt = () => {
    setEditingExisting(null);
    setSaveName('');
    setSavePromptOpen(true);
  };

  return (
    <div className="fixed inset-0 z-[220] flex justify-end" role="dialog" aria-modal="true" aria-label="自定义 CSS">
      {/* 背景遮罩 */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      {/* 抽屉主体 */}
      <div className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        {/* 顶部 */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <Code size={18} weight="bold" className="text-primary" />
            <h2 className="text-sm font-bold text-slate-800">自定义 CSS</h2>
            {activeName && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                当前：{activeName}
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

        {/* 提示 */}
        <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-[11px] leading-relaxed text-slate-500">
          这里的 CSS 作用在整个聊天页（用 <code className="rounded bg-slate-200 px-1 font-mono">.sully-chat-root</code> 锁定），
          跟「白框自定义 CSS」和聊天细节微调共存。需 <code className="rounded bg-slate-200 px-1 font-mono">!important</code> 才能盖过默认。
        </div>

        {/* 输入区 */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            placeholder="/* 在这里写 CSS，例如：&#10;.sully-chat-root .sully-bubble-ai { background: #fff5e6 !important; border-radius: 16px !important; } */"
            className="block h-64 w-full resize-y rounded-xl border border-slate-700 bg-slate-900 p-3 font-mono text-[12px] leading-relaxed text-slate-100 shadow-inner outline-none focus:border-primary"
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              onClick={handlePreview}
              className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-[11px] font-medium text-white shadow-sm hover:bg-slate-700 active:scale-95"
            >
              <Play size={12} weight="fill" />
              实时预览
            </button>
            <button
              onClick={openSavePrompt}
              className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-medium text-white shadow-sm hover:opacity-90 active:scale-95"
            >
              <FloppyDisk size={12} weight="fill" />
              保存为预设
            </button>
            <button
              onClick={handleLoadDefault}
              className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50 active:scale-95"
              title="把示例预设「暖色气泡」加载到输入框"
            >
              <Sparkle size={12} weight="fill" />
              载入示例
            </button>
            {activeName && (
              <button
                onClick={handleClearActive}
                className="ml-auto flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] font-medium text-rose-600 hover:bg-rose-100 active:scale-95"
              >
                <ArrowCounterClockwise size={12} weight="fill" />
                清空激活
              </button>
            )}
          </div>

          {/* 预设列表 */}
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[11px] font-semibold text-slate-600">已保存的预设（{presets.length}）</h3>
              {presets.some((p) => p.name === DEFAULT_PRESET_NAME) && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">含示例</span>
              )}
            </div>
            {presets.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-4 text-center text-[11px] text-slate-400">
                还没有预设。点上方「保存为预设」存一个，或「载入示例」开始。
              </div>
            ) : (
              <ul className="space-y-2">
                {presets.map((p) => {
                  const isActive = p.name === activeName;
                  return (
                    <li
                      key={p.name}
                      className={`rounded-xl border bg-white p-3 transition-all ${
                        isActive ? 'border-emerald-300 ring-1 ring-emerald-200' : 'border-slate-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <div className="truncate text-[12px] font-semibold text-slate-800">{p.name}</div>
                            {isActive && (
                              <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700">
                                激活
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 line-clamp-2 font-mono text-[10px] text-slate-400">
                            {p.css.split('\n').slice(0, 2).join(' · ')}
                            {p.css.split('\n').length > 2 ? ' …' : ''}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            onClick={() => handleApply(p)}
                            className="rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-white hover:opacity-90"
                            title="应用此预设到聊天页"
                          >
                            应用
                          </button>
                          <button
                            onClick={() => handleEdit(p)}
                            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-50"
                            title="把 CSS 加载到输入框（不立即应用）"
                          >
                            <PencilSimple size={10} weight="bold" />
                          </button>
                          <button
                            onClick={() => handleDelete(p)}
                            className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-medium text-rose-600 hover:bg-rose-100"
                            title="删除此预设"
                          >
                            <Trash size={10} weight="bold" />
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* 保存弹窗（小输入框） */}
        {savePromptOpen && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40" onClick={() => setSavePromptOpen(false)}>
            <div
              className="w-80 rounded-2xl bg-white p-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-2 text-[12px] font-semibold text-slate-800">保存为新预设</div>
              <div className="mb-3 text-[11px] text-slate-500">起个名字，下次可以直接应用。</div>
              <input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSavePreset();
                  if (e.key === 'Escape') setSavePromptOpen(false);
                }}
                placeholder="预设名"
                autoFocus
                className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-[12px] outline-none focus:border-primary"
              />
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
              {editingExisting && (
                <div className="mt-2 text-[10px] text-amber-600">编辑模式：保存会覆盖「{editingExisting}」</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CustomCssDrawer;
