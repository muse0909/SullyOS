/// <reference types="vite/client" />

// 麦麦 2026-09-03：后台保活 / 主动消息推送 Vite 环境变量类型
// 字段来源：.env.example
// 生产环境由 Vercel / Cloudflare Pages / 本地 .env 注入
interface ImportMetaEnv {
  readonly VITE_PROACTIVE_WORKER_URL?: string;
  readonly VITE_PROACTIVE_VAPID_PUBLIC_KEY?: string;
  readonly VITE_PROACTIVE_CLIENT_TOKEN?: string;
  // 既有 VITE_AMSG_* 保留（主动消息 2.0 用）
  readonly VITE_AMSG_VAPID_PUBLIC_KEY?: string;
  readonly VITE_AMSG_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
