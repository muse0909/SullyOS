// 麦麦 2026-09-03：module worker 模式下 DurableObject 不是 global，
// 必须从 cloudflare:workers 显式 import 才能 extends（否则运行时 "DurableObject is not defined"）
// 注意：build 脚本对 proactive-push 加了 external: ['cloudflare:workers']，所以 esbuild
// 不会去 Mac 上解析这个虚拟模块，import 字符串原样留在 bundle.js 里。
// CF 运行时 worker 看到 import { DurableObject } from "cloudflare:workers" 会从
// CF 提供的虚拟 module 拿到 DurableObject。
import { DurableObject } from "cloudflare:workers";
type DurableObjectState = any;  // 顺手类型 — 实际运行时 ctx 由 CF 注入

/**
 * WsHub — Cloudflare Durable Object holding live WebSocket connections.
 *
 * 暮色 2026-08-29 P0 第三步：给 proactive-push 加 WebSocket 直推通道。
 *
 * 为什么是 Durable Object：
 *   Cloudflare Worker 的多个 isolate 不共享内存。cron 跑在某个 isolate，
 *   WebSocket 连接握在另一个 isolate —— 要把 cron 的主动消息推到 WS 客户端
 *   就需要一个跨 isolate 的"集合点"，这就是 DO 干的事。
 *
 * 职责：
 *   1. 接住 /ws/push 的 upgrade 请求（index.ts 转发过来）
 *   2. 按 userId 维护连接池 Map<userId, Set<WebSocket>>
 *   3. 收 {"type":"ping"} 回 {"type":"pong"}（Android KeepAliveService 心跳）
 *   4. 暴露内部 HTTP 接口给 Worker：
 *      - POST /broadcast { characterId, content, timestamp }  给所有在线用户广播
 *      - GET  /stats   连接数统计（排障用）
 *
 * 不持久化：DO 重启内存清空，客户端会断线重连并重新注册，可接受。
 */

export class WsHub extends DurableObject {
  private readonly connections: Map<string, Set<WebSocket>> = new Map();

  // 麦麦 2026-09-03：CF 静态分析只认 extends DurableObject，不认 implements DurableObject
  // 加显式 constructor 把 ctx/env 传给 super — DurableObject 父类要求
  constructor(state: DurableObjectState, env: any) {
    super(state, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // ---------- WebSocket upgrade（来自 /ws/push 的转发） ----------
    if (url.pathname === '/connect') {
      return this.handleConnect(request);
    }

    // ---------- Worker → DO 的广播 ----------
    if (url.pathname === '/broadcast' && request.method === 'POST') {
      return this.handleBroadcast(request);
    }

    // ---------- 排障 ----------
    if (url.pathname === '/stats' && request.method === 'GET') {
      let total = 0;
      const perUser: Record<string, number> = {};
      for (const [userId, sockets] of this.connections) {
        perUser[userId] = sockets.size;
        total += sockets.size;
      }
      return new Response(JSON.stringify({ ok: true, total, perUser }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * 处理 WebSocket upgrade。
   * userId 从 query 拿（index.ts 已校验过 token）。
   */
  private handleConnect(request: Request): Response {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    if (!userId) {
      return new Response(JSON.stringify({ error: 'userId required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // CF Workers 的 WebSocket API：服务端 pair
    const pair = new WebSocketPair();
    const server = pair[1];

    server.accept();

    // 注册到连接池
    let set = this.connections.get(userId);
    if (!set) {
      set = new Set();
      this.connections.set(userId, set);
    }
    set.add(server);

    // 事件处理
    server.addEventListener('message', (event) => {
      let type = '';
      try {
        const data = JSON.parse(event.data as string);
        type = data?.type ?? '';
      } catch {
        return; // 非法 JSON 忽略
      }
      if (type === 'ping') {
        // 心跳响应（KeepAliveService 每 30s 发一个 ping）
        try {
          server.send(JSON.stringify({ type: 'pong', t: Date.now() }));
        } catch {
          // 连接可能已死 — 忽略，close 事件会清理
        }
      }
      // 其他 type 静默忽略（客户端未来可能发订阅列表之类）
    });

    server.addEventListener('close', () => {
      this.removeSocket(userId, server);
    });

    server.addEventListener('error', () => {
      this.removeSocket(userId, server);
    });

    // 返回给 Worker，Worker 再返回给客户端 — 完成握手
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  /**
   * 广播 proactive_message 给所有在线用户。
   * Worker 侧在 cron 里调用（POST body: { characterId, content, timestamp }）。
   *
   * 返回 { delivered: N }，Worker 用它判断"是否有在线用户收到"决定是否跳过 Web Push。
   */
  private async handleBroadcast(request: Request): Promise<Response> {
    let body: { characterId?: string; content?: string; timestamp?: number };
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'invalid json' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!body.characterId || !body.content) {
      return new Response(JSON.stringify({ error: 'characterId and content required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const payload = JSON.stringify({
      type: 'proactive_message',
      characterId: body.characterId,
      content: body.content,
      timestamp: body.timestamp ?? Date.now(),
    });

    let delivered = 0;
    for (const [userId, sockets] of this.connections) {
      for (const socket of sockets) {
        try {
          socket.send(payload);
          delivered++;
        } catch {
          this.removeSocket(userId, socket);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, delivered }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** 从连接池移除（close / error / send 失败时调用） */
  private removeSocket(userId: string, socket: WebSocket) {
    const set = this.connections.get(userId);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) this.connections.delete(userId);
  }
}
