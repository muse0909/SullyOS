// 暮色 2026-09-09：加载图管理（用户自己上传 + 默认那张浅蓝拱窗白天）
//
// 设计：
// - DEFAULT_LOADING_IMAGE_URL：暮色给的浅蓝拱窗白天图，做默认 fallback
//   资源在 public/loading-default.png，Vite build 后会同步到 dist/loading-default.png
// - CUSTOM_LOADING_IMAGE_KEY：用户上传的图（base64 dataURL）存在 localStorage
//   选 localStorage 而非 IDB 是不想动 DB_VERSION（72 了，每加一个 store 都要走升级流程）
//   5MB 限制够装单张图；超 4MB 时拒绝并提示
// - getActiveLoadingImageUrl：启动时调，有用户图就用户图，没有用默认
// - setCustomLoadingImage：读 File → base64 → localStorage
// - clearCustomLoadingImage：移除 localStorage，下次回默认
// - 启动时（index.tsx）在 root 还没渲染前就把 <img> 写进 #sullyos-loading

const DEFAULT_LOADING_IMAGE_URL = './loading-default.png';
const CUSTOM_LOADING_IMAGE_KEY = 'custom_loading_image';

const MAX_CUSTOM_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB 兜底（localStorage 总限 5MB，留点 buffer）

const readFileAsDataURL = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(file);
  });

/** 当前是否用了用户上传的图（用于设置面板显示「已上传」状态）。 */
export const hasCustomLoadingImage = (): boolean => {
  if (typeof localStorage === 'undefined') return false;
  return !!localStorage.getItem(CUSTOM_LOADING_IMAGE_KEY);
};

/** 取当前激活的加载图 URL：用户上传优先，没有用默认。 */
export const getActiveLoadingImageUrl = (): string => {
  if (typeof localStorage !== 'undefined') {
    const custom = localStorage.getItem(CUSTOM_LOADING_IMAGE_KEY);
    if (custom) return custom;
  }
  return DEFAULT_LOADING_IMAGE_URL;
};

/** 上传用户图：File → base64 dataURL → localStorage。超 4MB 抛错。 */
export const setCustomLoadingImage = async (file: File): Promise<void> => {
  if (file.size > MAX_CUSTOM_IMAGE_BYTES) {
    throw new Error(`图片太大（${(file.size / 1024 / 1024).toFixed(2)}MB），请压到 4MB 以内`);
  }
  const dataUrl = await readFileAsDataURL(file);
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CUSTOM_LOADING_IMAGE_KEY, dataUrl);
  } catch (e) {
    // QuotaExceededError 之类 — 提示用户图太大
    throw new Error('保存失败，浏览器存储空间不够');
  }
};

/** 清除用户图：下次启动回默认。 */
export const clearCustomLoadingImage = (): void => {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(CUSTOM_LOADING_IMAGE_KEY);
};

/** 默认图 URL — 给设置面板预览用。 */
export const getDefaultLoadingImageUrl = (): string => DEFAULT_LOADING_IMAGE_URL;
