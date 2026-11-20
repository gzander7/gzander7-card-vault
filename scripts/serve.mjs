// Minimal static server for local development and browser tests. GitHub Pages
// serves the same files in production; there is no build step.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT) || 4173;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};
const hidden = ['node_modules', '.git', 'supabase', 'e2e', 'scripts', 'test-results'];

createServer(async (request, response) => {
  try {
    const { pathname } = new URL(request.url, 'http://localhost');
    const relative = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
    if (relative.split(sep).some(part => part.startsWith('.') || hidden.includes(part))) throw new Error('hidden');
    let file = join(root, relative);
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    response.writeHead(200, {
      'Content-Type': types[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Card Vault on http://127.0.0.1:${port}/`));
