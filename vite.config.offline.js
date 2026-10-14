// vite.config.offline.js — 离线分发版构建配置
//
// 目的：产出「双击 index.html 即可玩」的自包含目录。
//
// 为什么默认构建不行：默认产物是 ES module（<script type="module">），
// 从 file:// 打开时浏览器按 CORS 拒绝加载模块脚本，页面白屏。
// 因此这里改为 IIFE 格式（经典脚本），并在构建后把 JS/CSS 内联进 index.html，
// 消除一切需要网络或模块解析的请求；图片仍作为相对路径文件随目录分发
// （相对路径的 <img> / TextureLoader 在 file:// 下不受模块 CORS 限制）。
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'demo',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    assetsInlineLimit: 0,
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
