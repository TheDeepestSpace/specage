// Minimal SPA server for the built web app (mirrors the real server's index handling:
// absolute asset URLs + index.html fallback). All API calls are mocked in the tests.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const [dir, port] = [resolve(process.argv[2]), Number(process.argv[3])];
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };
createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(dir, normalize(p).replace(/^([/\\]|\.\.)+/g, ''));
  if (p !== '/' && file.startsWith(dir) && existsSync(file) && statSync(file).isFile()) {
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    return res.end(readFileSync(file));
  }
  const html = readFileSync(join(dir, 'index.html'), 'utf8').replaceAll(
    '="./assets/',
    '="/assets/',
  );
  res.writeHead(200, { 'content-type': MIME['.html'] }).end(html);
}).listen(port, '127.0.0.1');
