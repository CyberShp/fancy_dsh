import { randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'fancy-dsh-startup';
export const inject = ['webServer'];
export const PREFIX = '/__fancy_dsh';
const instance = randomUUID();
const integrationRoot = dirname(fileURLToPath(import.meta.url));
const runtimeRoot = resolve(integrationRoot, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const emptyInventory = error => ({ mode: 'unavailable', skills: [], mcps: [], skillCount: 0, mcpCount: 0, error });
const cleanName = value => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f-\u009f<>]/g, '').trim().slice(0, 96) : '';

export function localRequest(req, port) {
  const host = req.headers.host;
  const localHosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
  if (!localHosts.includes(host)) return false;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)) return false;
  if (req.headers.origin && req.headers.origin !== `http://${host}`) return false;
  return req.headers['sec-fetch-site'] !== 'cross-site';
}

function service(ctx, key) { return typeof ctx.get === 'function' ? ctx.get(key) : ctx[key]; }

/** Read names only. The MCP list is the configured directory, not a connection test. */
export async function inventory(ctx, timeoutMs = 2000, externalSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (externalSignal?.aborted) abort();
  else externalSignal?.addEventListener('abort', abort, { once: true });
  let timer;
  const stopped = new Promise((_, reject) => {
    const stop = () => reject(new Error('inventory-unavailable'));
    controller.signal.addEventListener('abort', stop, { once: true });
    if (controller.signal.aborted) stop();
    timer = setTimeout(abort, timeoutMs);
  });
  const read = async () => {
    const skillsService = service(ctx, 'skills');
    const presets = service(ctx, 'agentPresets');
    const loader = service(ctx, 'loader');
    if (typeof skillsService?.snapshot !== 'function' || typeof presets?.standingKeyFor !== 'function' || typeof loader?.entries !== 'function') {
      throw new Error('inventory-unavailable');
    }
    controller.signal.throwIfAborted();
    const scope = await presets.standingKeyFor();
    controller.signal.throwIfAborted();
    const snapshot = await skillsService.snapshot({ cwd: process.cwd(), scope, signal: controller.signal });
    controller.signal.throwIfAborted();
    if (snapshot?.complete !== true || !Array.isArray(snapshot.skills)) throw new Error('inventory-unavailable');
    const skills = [...new Set(snapshot.skills.map(row => cleanName(row.name)).filter(Boolean))].sort();
    const mcpNames = new Set();
    for (const entry of loader.entries()) {
      controller.signal.throwIfAborted();
      if (entry.disabled || entry.options?.disabled === true || entry.options?.group) continue;
      const module = entry.options?.name;
      if (module !== '@deepseek-ai/dsh-mcp-client' && module !== 'mcp-client') continue;
      const serverName = cleanName(entry.fiber?.config?.serverName ?? entry.options?.config?.serverName);
      if (serverName) mcpNames.add(serverName);
    }
    const mcps = [...mcpNames].sort().map(name => ({ name, label: 'MCP SERVER' }));
    return { mode: 'live', skills, mcps, skillCount: skills.length, mcpCount: mcps.length };
  };
  try { return await Promise.race([read(), stopped]); }
  catch { return emptyInventory('Local inventory could not be read.'); }
  finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abort);
  }
}

function json(res, status, body, head = false) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Content-Length': data.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(head ? undefined : data);
}

function assetAllowed(relative) {
  if (relative === 'dist/ship.js' || /^dist\/vendor\/three\.(?:module|core)(?:\.min)?\.js$/.test(relative)) return true;
  if (/^dist\/cinematic\/(?:[\w-]+\.(?:html|css|js)|assets\/[\w-]+\.(?:wav|mp3|ogg|json|png|webp|svg))$/.test(relative)) return true;
  return /^dist\/assets\/fonts\/[\w.-]+\.(?:css|ttf|woff2?|txt)$/.test(relative);
}

export function createHandler(ctx) {
  return async (req, res) => {
    const head = req.method === 'HEAD';
    if (!localRequest(req, ctx.webServer.port)) return json(res, 403, { error: 'Local requests only.' }, head);
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed.' });
    try {
      const path = decodeURIComponent(req.url.split(/[?#]/, 1)[0]);
      if (/[\\\u0000-\u001f\u007f]/.test(path) || path.split('/').some(part => part === '.' || part === '..') || !path.startsWith(PREFIX + '/')) {
        return json(res, 404, { error: 'Asset not found.' }, head);
      }
      const relative = path.slice(PREFIX.length + 1);
      if (relative === 'inventory') {
        if (head) return json(res, 405, { error: 'Method not allowed.' }, true);
        const controller = new AbortController();
        const abort = () => controller.abort();
        res.on?.('close', abort);
        const result = await inventory(ctx, 2000, controller.signal);
        res.off?.('close', abort);
        if (!res.destroyed) json(res, 200, result);
        return;
      }
      let absolute;
      let contentType;
      if (relative === 'overlay.js') {
        absolute = resolve(integrationRoot, 'overlay.js');
        contentType = MIME['.js'];
      } else {
        const asset = relative === 'dist/cinematic/' ? 'dist/cinematic/index.html' : relative;
        if (!assetAllowed(asset)) return json(res, 404, { error: 'Asset not found.' }, head);
        absolute = resolve(runtimeRoot, asset);
        contentType = MIME[extname(absolute)];
      }
      const [root, target] = await Promise.all([realpath(runtimeRoot), realpath(absolute)]);
      if (!target.startsWith(root + sep)) return json(res, 404, { error: 'Asset not found.' }, head);
      const content = await readFile(target);
      res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': content.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' });
      res.end(head ? undefined : content);
    } catch {
      if (!res.headersSent) json(res, 404, { error: 'Asset not found.' }, head);
      else res.end();
    }
  };
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler: createHandler(ctx) }));
  ctx.on('webserver/index-inject', table => {
    table.push({ kind: 'global', name: '__FANCY_DSH_BOOT__', value: { instance, enabled: process.env.FANCY_DSH_ENABLED !== '0' } });
    table.push({ kind: 'script-src', placement: 'head', src: `${PREFIX}/overlay.js` });
  });
}
