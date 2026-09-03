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
    // 麦麦 2026-09-03：cf 专有虚拟模块 cloudflare:workers 在 Mac 上不存在
    // 但 CF 运行时（workerd）会提供 — 加 external 让 esbuild 保留 import 字符串不解析
    external: ['cloudflare:workers'],
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
      // 麦麦 2026-09-03：minify: false — esbuild 0.21.5 的 minifyIdentifiers: false
      // 参数有 bug（仍然压了 class identifier），整个关掉 minify 才能让
      // `class WsHub extends DurableObject` 在 bundle 里保留名字。
      // CF 静态分析（扫描 worker export 找 DurableObject subclass）需要看到 class
      // 名字没被压。bundle 从 11KB 涨到 ~25KB，free tier 1MB 限制内完全 OK。
      minify: false,
      treeShaking: true,
      legalComments: 'none',
      // 麦麦 2026-09-03：worker 配的 external（cloudflare:workers 等）让 esbuild 保留
      // import 字符串不解析 — CF 运行时（workerd）会从专有虚拟模块 resolve
      external: w.external || [],
      logLevel: 'info',
    });
    const dt = Date.now() - t0;
    console.log(`[build-workers] ✓ ${w.name.padEnd(16)} ${w.outfile}  (${dt}ms)`);
  }),
);

const dt = Date.now() - start;
console.log(`[build-workers] done in ${dt}ms`);
