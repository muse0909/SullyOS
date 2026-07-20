/**
 * _test.ts — 最小测试 endpoint
 *
 * 用途：验证 Vercel 函数本身能不能正常秒回
 *      — 完全不动 Neon SDK / DATABASE_URL / 任何 DB 操作
 *      — 部署后浏览器访问 /api/_test 立即返 JSON
 *
 * 如果 /api/_test 秒回 + /api/sync 转圈 → 问题在 @neondatabase/serverless 1.0.2
 * 如果两个都转圈 → Vercel 函数整个挂（路由 / build 问题）
 */

export default async () => ({
    statusCode: 200,
    headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
        ok: true,
        time: Date.now(),
        message: 'Vercel function works — no Neon SDK involved',
    }),
});
