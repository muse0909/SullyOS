/**
 * Cloudflare Workers 打包脚本
 *
 * 主动消息 2.0（worker/amsg/）+ 主动消息 1.0 push 加速器（worker/proactive-push/）统一打。
 *
 *   - 输入：worker/<name>/src/index.ts
 *   - 输出：worker/<name>/worker.bundle.js
 *   - 格式：ESM（Cloudflare Workers 默认）
 *
 * 跑法：
 *   - node scripts/build-workers.mjs           全部
 *   - node scripts/build-workers.mjs amsg      只打 amsg
 *
 * 暮色说"主动消息 2.0 worker 跟 1.0 push 加速器是同形态"——所以把两个
 * worker 的 build 收口到一个脚本里，以后再加新 worker 也只在这个数组里
 * 加一行即可。
 *
 * 设计要点：
 *   - platform: 'neutral' → 不引任何 node 内置模块；amsg-server/cloudflare
 *     子路径用的就是纯 Web Crypto，不会偷偷 require('crypto')。
 *   - 不带 nodejs_compat flag 也能跑（README 401 行明说了）。
 *   - target: es2022 → Cloudflare Workers 运行时支持 es2022 所有语法。
 *   - minify + treeShaking 默认开，bundle 体积控在 200KB 内。
 *   - banner 不带（proactive-push 老的 worker.bundle.js 头部那段注释
 *     是手工的，新打的走 esbuild 默认）。
 */

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

/** 哪些 worker 要打。顺序无所谓，Promise.all 并行。 */
const WORKERS = [
  {
    name: 'amsg',
    /** 主动消息 2.0 入口：env 注入 + SDK 装配 */
    entry: 'worker/amsg/src/index.ts',
    /** 打到 worker/amsg/worker.bundle.js（同 worker/proactive-push 旧约定） */
    outfile: 'worker/amsg/worker.bundle.js',
  },
  {
    name: 'proactive-push',
    /** 主动消息 1.0 push 加速器（暮色 6-6 老代码，重新纳入构建） */
    entry: 'worker/proactive-push/src/index.ts',
    outfile: 'worker/proactive-push/worker.bundle.js',
  },
];

/** 只打指定名字的 worker（CLI 第一个参数） */
const onlyArg = process.argv[2];
const targets = onlyArg
  ? WORKERS.filter((w) => w.name === onlyArg)
  : WORKERS;

if (onlyArg && targets.length === 0) {
  console.error(`[build-workers] unknown worker: ${onlyArg}`);
  console.error(`[build-workers] available: ${WORKERS.map((w) => w.name).join(', ')}`);
  process.exit(1);
}

const start = Date.now();
console.log(`[build-workers] ${targets.length} worker(s): ${targets.map((t) => t.name).join(', ')}`);

await Promise.all(
  targets.map(async (w) => {
    const entryAbs = path.join(repoRoot, w.entry);
    const outAbs = path.join(repoRoot, w.outfile);
    const t0 = Date.now();
    await build({
      entryPoints: [entryAbs],
      outfile: outAbs,
      bundle: true,
      format: 'esm',
      target: 'es2022',
      platform: 'neutral',
      minify: true,
      treeShaking: true,
      legalComments: 'none',
      // 不引任何 cloudflare: 模块——amsg-server 没用，proactive-push 也没用
      // （VAPID JWT 用纯 Web Crypto 算）
      logLevel: 'info',
    });
    const dt = Date.now() - t0;
    console.log(`[build-workers] ✓ ${w.name.padEnd(16)} ${w.outfile}  (${dt}ms)`);
  }),
);

const dt = Date.now() - start;
console.log(`[build-workers] done in ${dt}ms`);
