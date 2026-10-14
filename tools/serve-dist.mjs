// 本地静态服务器（本任务验收用）：把 dist/ 同时挂在 / 与 /time-gallery/ 两个前缀下，
// 后者用于模拟 GitHub Pages 的项目子路径布局。
// 用法：node tools/_serve.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const dist = path.join(root, 'dist');
const port = Number(process.argv[2] || 8901);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  if (rel.startsWith('/time-gallery/')) rel = rel.slice('/time-gallery'.length);
  rel = rel.replace(/^\/+/, '') || 'index.html';
  const file = path.join(dist, rel);
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
server.listen(port, '127.0.0.1', () => console.log(`serving dist on http://127.0.0.1:${port}/ and /time-gallery/`));
