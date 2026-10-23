import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookupQuery } from './lib/glossary.js';
import { searchAround } from './lib/amap.js';
import { translationEnabled, translateQuery, translatePlaces } from './lib/translate.js';
import { wechatEnabled, jsSdkConfig } from './lib/wechat.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, 'public');

try {
  process.loadEnvFile(path.join(here, '.env'));
} catch {
  // No .env file; rely on the real environment.
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

// AMap JS API security proxy: the browser never sees the security code.
// Mirrors the nginx config in AMap's docs (lbs.amap.com/api/javascript-api-v2/guide/abc/jscode).
const AMAP_PROXY_TARGETS = [
  ['/_AMapService/v4/map/styles', 'https://webapi.amap.com/v4/map/styles'],
  ['/_AMapService/v3/vectormap', 'https://fmap01.amap.com/v3/vectormap'],
  ['/_AMapService/', 'https://restapi.amap.com/'],
];

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function handleSearch(url, res) {
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const lng = parseFloat(url.searchParams.get('lng'));
  const lat = parseFloat(url.searchParams.get('lat'));
  const radius = parseInt(url.searchParams.get('radius') || '3000', 10);
  if (!q || !Number.isFinite(lng) || !Number.isFinite(lat)) {
    return sendJson(res, 400, { error: 'q, lng and lat are required' });
  }

  let keywords = lookupQuery(q);
  if (!keywords && translationEnabled()) {
    keywords = await translateQuery(q).catch((err) => {
      console.warn('Query translation failed:', err.message);
      return null;
    });
  }
  // AMap also matches some Latin-script names (brands, "KTV", "ATM").
  keywords ||= q;

  const pois = await searchAround({ key: process.env.AMAP_WEB_SERVICE_KEY, keywords, lng, lat, radius });
  if (translationEnabled() && pois.length) {
    await translatePlaces(pois).catch((err) => console.warn('Name translation failed:', err.message));
  }
  sendJson(res, 200, { query: q, keywords, results: pois });
}

async function handleAmapProxy(url, res) {
  const match = AMAP_PROXY_TARGETS.find(([prefix]) => url.pathname.startsWith(prefix));
  const target = new URL(match[1] + url.pathname.slice(match[0].length));
  target.search = url.search;
  target.searchParams.set('jscode', process.env.AMAP_JS_SECURITY_CODE || '');
  const upstream = await fetch(target);
  res.writeHead(upstream.status, {
    'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
  });
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

async function serveStatic(url, res) {
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const file = path.join(publicDir, rel);
  if (!file.startsWith(publicDir + path.sep)) return sendJson(res, 403, { error: 'forbidden' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'not found' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/config') {
      return sendJson(res, 200, {
        amapKey: process.env.AMAP_JS_KEY || '',
        wechat: wechatEnabled(),
        translation: translationEnabled(),
      });
    }
    if (url.pathname === '/api/search') return await handleSearch(url, res);
    if (url.pathname === '/api/wechat-config') {
      if (!wechatEnabled()) return sendJson(res, 404, { error: 'WeChat is not configured' });
      return sendJson(res, 200, await jsSdkConfig(url.searchParams.get('url') || ''));
    }
    if (url.pathname.startsWith('/_AMapService/')) return await handleAmapProxy(url, res);
    return await serveStatic(url, res);
  } catch (err) {
    console.error(err);
    sendJson(res, 502, { error: err.message });
  }
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => console.log(`China Maps running at http://localhost:${port}`));
