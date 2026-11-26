/* GD Krillion 1.1.0 — zero-dependency static server + live GDHistory proxy.
 *
 * GDHistory does not send Access-Control-Allow-Origin, so browsers cannot read
 * it directly. /api/history fetches the live API here and returns JSON to the
 * page with the same origin, which lets the GDBrowser fallback really use
 * GDHistory before the bundled verified snapshot.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3003;
const HISTORY_API = 'https://history.geometrydash.eu/api/v1/search/level/advanced/';
const HISTORY_TIMEOUT_MS = 6000;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8'
};

function baseHeaders() {
  return {
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff'
  };
}

function send(res, status, body, headers = {}, method = 'GET') {
  res.writeHead(status, { ...baseHeaders(), ...headers });
  res.end(method === 'HEAD' ? undefined : body);
}

function sendJSON(res, status, data, method = 'GET') {
  send(res, status, JSON.stringify(data), { 'Content-Type': CONTENT_TYPES['.json'] }, method);
}

function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return send(res, 400, 'Bad request', { 'Content-Type': CONTENT_TYPES['.txt'] }, req.method);
  }
  if (rel === '/' || rel === '') rel = '/index.html';

  const filePath = path.resolve(ROOT, `.${rel}`);
  const rootWithSep = ROOT.endsWith(path.sep) ? ROOT : `${ROOT}${path.sep}`;
  if (filePath !== path.join(ROOT, 'index.html') && !filePath.startsWith(rootWithSep)) {
    return send(res, 403, 'Forbidden', { 'Content-Type': CONTENT_TYPES['.txt'] }, req.method);
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      return send(res, 404, 'Not found', { 'Content-Type': CONTENT_TYPES['.txt'] }, req.method);
    }
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, data, {
      'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream'
    }, req.method);
  });
}

async function handleHistory(req, res, url) {
  if (req.method !== 'GET') {
    return sendJSON(res, 405, { error: 'Method not allowed' }, req.method);
  }

  const query = (url.searchParams.get('query') || '').trim();
  if (!query || query.length > 120) {
    return sendJSON(res, 400, { error: 'Invalid query' }, req.method);
  }
  const limitParam = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(100, Math.floor(limitParam))
    : 25;

  const upstreamUrl = `${HISTORY_API}?query=${encodeURIComponent(query)}&limit=${limit}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HISTORY_TIMEOUT_MS);

  try {
    const upstream = await fetch(upstreamUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (!upstream.ok) {
      return sendJSON(res, 502, { error: `GDHistory returned ${upstream.status}` }, req.method);
    }
    const data = await upstream.json();
    if (!data || !Array.isArray(data.hits)) {
      return sendJSON(res, 502, { error: 'GDHistory response missing hits' }, req.method);
    }
    sendJSON(res, 200, data, req.method);
    console.log(`[history] ${query} -> ${data.hits.length} hit(s)`);
  } catch (err) {
    const message = err && err.name === 'AbortError'
      ? 'GDHistory timed out'
      : 'GDHistory unavailable';
    sendJSON(res, 502, { error: message }, req.method);
    console.warn(`[history] ${query} -> ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  } catch {
    return send(res, 400, 'Bad request', { 'Content-Type': CONTENT_TYPES['.txt'] }, req.method);
  }

  if (url.pathname === '/api/history') return handleHistory(req, res, url);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJSON(res, 405, { error: 'Method not allowed' }, req.method);
  }
  return serveStatic(req, res, url.pathname);
}).listen(PORT, () => {
  console.log(`GD Krillion running at http://localhost:${PORT}/`);
  console.log('Live GDHistory fallback: /api/history?query=...&limit=25');
});
