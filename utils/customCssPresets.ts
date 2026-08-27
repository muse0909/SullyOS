// 暮色 2026-08-27 第二步：用户自定义聊天白框 CSS — 预设管理（localStorage 增删查改 + 预装示例）
//
// 设计：
// - custom_css_presets: JSON 数组，每项 {name: string, css: string} —— 命名预设列表
// - custom_css_active: 当前激活预设的名字（无则空串）—— 启动时按它注入 style.innerHTML
// - 预装一个"示例-暖色气泡"：首次加载时若 custom_css_presets 为空数组，自动塞进去并设为激活
// - 「实时预览」写 style 标签但不写 localStorage，「保存为预设」才落库；「应用」写 localStorage + 注入
// - 改名为「编辑」时直接覆盖同名预设（用户可能想微调），删时如果删的是激活的也清空激活名

export interface CustomCssPreset {
  name: string;
  css: string;
}

const PRESETS_KEY = 'custom_css_presets';
const ACTIVE_KEY = 'custom_css_active';

/** 预装示例预设：暖色气泡 + 圆角 16px，让暮色知道格式和选择器怎么写。
 *  选择器用 .sully-chat-root 包裹，命中整个聊天 App 根。气泡根用 .sully-bubble-ai / .sully-bubble-user。
 *  「背景」用浅暖色 + 圆角 16px + 细边 1px。 */
export const DEFAULT_PRESET_NAME = '示例-暖色气泡';
export const DEFAULT_PRESET_CSS = `/* 暖色气泡 + 16px 圆角
   选 .sully-chat-root 锁定聊天 App
   .sully-bubble-ai / .sully-bubble-user 是每条消息气泡的根
   跟 !important 覆盖默认样式 */

.sully-chat-root .sully-bubble-ai,
.sully-chat-root .sully-bubble-user {
  background: #fff5e6 !important;
  border: 1px solid #f3d9b1 !important;
  border-radius: 16px !important;
  box-shadow: 0 1px 2px rgba(180, 120, 60, 0.08);
}

/* 顶栏浅暖 */
.sully-chat-root .sully-chat-back,
.sully-chat-root .sully-chat-inputbar {
  background: #fdf3e0 !important;
}
`;

const safeParse = <T,>(s: string | null, fallback: T): T => {
  if (!s) return fallback;
  try {
    const v = JSON.parse(s);
    return v as T;
  } catch {
    return fallback;
  }
};

export const loadPresets = (): CustomCssPreset[] => {
  if (typeof localStorage === 'undefined') return [];
  return safeParse<CustomCssPreset[]>(localStorage.getItem(PRESETS_KEY), []);
};

export const savePresets = (presets: CustomCssPreset[]): void => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
};

export const getActivePresetName = (): string => {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem(ACTIVE_KEY) || '';
};

export const setActivePresetName = (name: string): void => {
  if (typeof localStorage === 'undefined') return;
  if (name) localStorage.setItem(ACTIVE_KEY, name);
  else localStorage.removeItem(ACTIVE_KEY);
};

/** 启动时调用：若预设列表为空则预装示例预设（不主动激活——避免老用户进应用突然发现样式被改了）。 */
export const ensureDefaultPreset = (): CustomCssPreset[] => {
  const existing = loadPresets();
  if (existing.length > 0) return existing;
  const seeded: CustomCssPreset[] = [{ name: DEFAULT_PRESET_NAME, css: DEFAULT_PRESET_CSS }];
  savePresets(seeded);
  return seeded;
};

/** 同步注入到 <style id="user-custom-css"> —— 任何调用方（启动 / 实时预览 / 应用）都走这条。
 *  返回当前激活预设的 CSS；空串 = 清空。 */
export const syncUserCustomCssToDom = (css: string): void => {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('user-custom-css');
  if (!el) return;
  el.textContent = css;
};

/** 按预设名查预设，未找到返回 undefined。 */
export const findPreset = (presets: CustomCssPreset[], name: string): CustomCssPreset | undefined =>
  presets.find((p) => p.name === name);

/** 启动时（App 挂载后）调用一次：注入激活预设 CSS。 */
export const bootstrapUserCustomCss = (): void => {
  const activeName = getActivePresetName();
  if (!activeName) {
    syncUserCustomCssToDom('');
    return;
  }
  const presets = loadPresets();
  const p = findPreset(presets, activeName);
  syncUserCustomCssToDom(p?.css || '');
};
