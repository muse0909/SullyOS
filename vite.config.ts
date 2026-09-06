import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { bakeVoiceMiddleware } from './server/bake-voice-middleware';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'bake-voice-middleware',
      configureServer(server) {
        server.middlewares.use('/api/minimax/bake-voice', bakeVoiceMiddleware);
      },
    },
    // 麦麦 2026-09-06：APK WebView 缓存根治的 build id 兜底
    //   Vite 4+ 的 define 对 globalThis.* 类的赋值不生效（试过 declare const + globalThis 都失败）
    //   改用 transformIndexHtml 往 index.html 注入 <meta name="sullyos-build-id">，运行时读
    //   每次 build 生成新 build id（ISO 时间戳到分钟），部署到 Vercel 后 APK 端 reload
    {
      name: 'sullyos-build-id',
      transformIndexHtml() {
        const buildId = new Date().toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
        return [
          {
            tag: 'meta',
            injectTo: 'head',
            attrs: {
              name: 'sullyos-build-id',
              content: buildId,
            },
          },
        ];
      },
    },
  ],
  // GitHub Pages 发布时使用相对路径，避免仓库子路径导致资源 404
  base: process.env.GITHUB_PAGES ? './' : '/',
  esbuild: {
    // 只剥 debugger，保留 console.* —— 部署后按 F12 仍能看到运行时日志，方便排查。
    drop: ['debugger'],
  },
  server: {
    proxy: {
      '/api/minimax/t2a': {
        target: 'https://api.minimaxi.com',
        changeOrigin: true,
        secure: true,
        rewrite: () => '/v1/t2a_v2',
        // Route to 国服 / 海外 based on X-MiniMax-Region header sent by the client.
        router: (req) => {
          const region = String(req.headers['x-minimax-region'] || '').toLowerCase();
          return region === 'overseas' ? 'https://api.minimax.io' : 'https://api.minimaxi.com';
        },
      },
      '/api/minimax/get-voice': {
        target: 'https://api.minimaxi.com',
        changeOrigin: true,
        secure: true,
        rewrite: () => '/v1/get_voice',
        router: (req) => {
          const region = String(req.headers['x-minimax-region'] || '').toLowerCase();
          return region === 'overseas' ? 'https://api.minimax.io' : 'https://api.minimaxi.com';
        },
      },
      '/api/minimax/music': {
        target: 'https://api.minimaxi.com',
        changeOrigin: true,
        secure: true,
        rewrite: () => '/v1/music_generation',
        router: (req) => {
          const region = String(req.headers['x-minimax-region'] || '').toLowerCase();
          return region === 'overseas' ? 'https://api.minimax.io' : 'https://api.minimaxi.com';
        },
      },
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      // 关键修复：将这些包排除在打包之外，让浏览器通过 index.html 的 importmap 加载
      external: ['pdfjs-dist', 'katex'],
      onwarn(warning, defaultHandler) {
        // 抑制动态导入与静态导入混合的无害警告
        if (warning.message?.includes('dynamic import will not move module into another chunk')) return;
        defaultHandler(warning);
      },
      output: {
        // 麦麦 2026-09-06：显式声明 hash 文件名（Vite 默认就有，显式更稳）
        //   暮色 9-6 反馈 APK WebView 反复缓存 — 确认文件名变化能被检测到
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash].[ext]',
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom') || id.includes('scheduler')) {
              return 'vendor-react';
            }
            if (id.includes('@phosphor-icons')) {
              return 'vendor-icons';
            }
            if (id.includes('@capacitor')) {
              return 'vendor-capacitor';
            }
            return 'vendor';
          }
          if (id.includes('utils/memoryPalace')) {
            return 'memory-palace';
          }
        }
      }
    }
  }
});
