// 暮色 2026-08-27 页面缩放：纯前端 CSS zoom 方案（替代原生 WebView setInitialScale/setSupportZoom）
//   - 设置页「页面缩放」滑条（apps/Settings.tsx）→ setPageZoom() 保存并应用
//   - 启动时 index.tsx 调 applyPageZoom() 从 localStorage 恢复上次的值
//   - zoom 自 2024-05 起是 CSS 标准属性（Baseline 2024）：Chrome / Android WebView / iOS Safari /
//     Firefox 126+ 全支持，不需要 transform: scale 兜底。transform: scale 在根元素上会缩小
//     整页留白边、fixed 弹窗定位也会乱，zoom 没有这些问题 —— 选型依据见 changelog。
const STORAGE_KEY = 'sullyos_page_zoom';

export const PAGE_ZOOM_MIN = 70;
export const PAGE_ZOOM_MAX = 130;
export const PAGE_ZOOM_DEFAULT = 100;
export const PAGE_ZOOM_STEP = 5;

/** 把任意输入夹到 [70, 130] 区间并按步进取整；非法输入回退默认 100 */
export function clampPageZoom(input: unknown): number {
  const n = Math.round(Number(input));
  if (!Number.isFinite(n)) return PAGE_ZOOM_DEFAULT;
  return Math.min(PAGE_ZOOM_MAX, Math.max(PAGE_ZOOM_MIN, n));
}

/** 从 localStorage 读上次保存的缩放百分比；没有或损坏时返回默认 100 */
export function readSavedPageZoom(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return PAGE_ZOOM_DEFAULT;
    return clampPageZoom(raw);
  } catch {
    // 无痕模式 / 存储被禁等场景静默降级为默认值
    return PAGE_ZOOM_DEFAULT;
  }
}

/** 只把缩放应用到页面根元素，不写存储（挂 html 上 = 整页连 fixed 弹窗一起缩放） */
export function applyPageZoom(percent?: number): void {
  const pct = clampPageZoom(percent ?? readSavedPageZoom());
  document.documentElement.style.zoom = String(pct / 100);
}

/** 设置页入口：保存 localStorage + 应用，一步到位。拖动滑条时每次变化都调它 */
export function setPageZoom(percent: number): void {
  const pct = clampPageZoom(percent);
  try {
    localStorage.setItem(STORAGE_KEY, String(pct));
  } catch {
    // 写不进去也没关系，本次会话仍然生效
  }
  applyPageZoom(pct);
}
