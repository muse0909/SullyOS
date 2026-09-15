/**
 * 麦麦 2026-09-15：worker 端 tsc 兼容层
 *
 * 背景：
 *   - SullyOS 的 utils/ 大量依赖浏览器 API（localStorage / IndexedDB / DOM），
 *     但只有一部分代码会被 esbuild 打进 worker bundle —— 运行时不被调用就不会报错。
 *   - 但 TypeScript 不知道这个取舍，对所有 import 链上的文件都做完整类型检查，
 *     导致 worker tsc 一堆"Cannot find name 'localStorage'"之类无意义的错。
 *
 * 解决：
 *   - 给 worker tsc 加一份 ambient 声明，把这些浏览器全局当成存在但未类型化的。
 *   - esbuild 打 bundle 不看这些声明（运行时靠实际代码），不影响产物。
 *   - 真要补正确实现是 worker 端用 D1 binding 替换 IndexedDB 等，那是单独工程。
 *
 * 跟 tsconfig.worker.json 的 lib=ES2022 配套（ES2022 没 DOM lib），
 * 这里只声明 worker tsc 看得见的几个全局符号。
 */

declare const localStorage: {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  key(index: number): string | null;
  readonly length: number;
};

declare const MAX_SAMPLED_SONGS: number;