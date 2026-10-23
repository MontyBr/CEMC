import { wgs84ToGcj02 } from './coords.js';
import { lookupQuery } from './glossary.js';
import { searchAmapJs, searchTencent, searchOsm } from './places.js';
import { createAmapView, createLeafletView, loadScript } from './mapviews.js';

const DEFAULT_CENTER = [121.4737, 31.2304]; // Shanghai, until we know where you are
const isWeChat = /MicroMessenger/i.test(navigator.userAgent);

const $ = (id) => document.getElementById(id);
// mode: 'server' (Node server with AMap keys), 'amap' or 'tencent' (static
// site with a key in config.json) or 'osm' (no keys: OpenStreetMap places).
const state = { mode: null, config: {}, view: null, here: null, results: [], selected: -1, searchSeq: 0 };
// Resolves once the map exists, so a search tapped during loading just waits.
let markViewReady;
const viewReady = new Promise((resolve) => (markViewReady = resolve));

// ---------- helpers ----------

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function toast(message, ms = 2500) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), ms);
}

function formatDistance(m) {
  if (m == null) return '';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

function stars(rating) {
  if (!rating) return '';
  return `<span class="stars">★</span> ${rating.toFixed(1)}`;
}

function title(place) {
  return place.nameEn || place.category || place.name;
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older WebViews: fall back to a hidden textarea.
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

async function getJson(url) {
  try {
    const res = await fetch(url);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// ---------- setup ----------

async function loadConfig() {
  const server = await getJson('api/config');
  if (server?.amapKey) return { mode: 'server', config: server };
  // On static hosting the deploy workflow can write AMap / Tencent keys here.
  const file = await getJson('config.json');
  if (file?.amapKey) return { mode: 'amap', config: file };
  if (file?.tencentKey) return { mode: 'tencent', config: file };
  return { mode: 'osm', config: {} };
}

function createView() {
  const el = $('map');
  if (state.mode === 'server') {
    // Requests that need the AMap security code go through our server's proxy.
    const securityConfig = { serviceHost: `${location.origin}/_AMapService` };
    return createAmapView(el, { key: state.config.amapKey, securityConfig, center: DEFAULT_CENTER });
  }
  if (state.mode === 'amap') {
    const securityConfig = { securityJsCode: state.config.amapSecurityCode };
    return createAmapView(el, { key: state.config.amapKey, securityConfig, center: DEFAULT_CENTER });
  }
  // Tencent and AMap both use GCJ-02, so Tencent places sit correctly on AMap's tiles.
  const places =
    state.mode === 'tencent'
      ? 'Places © Tencent'
      : 'Places © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  return createLeafletView(el, { center: DEFAULT_CENTER, attribution: `Map © AutoNavi · ${places}` });
}

// ---------- location (always returned as GCJ-02) ----------

async function wechatReady() {
  if (wechatReady.promise) return wechatReady.promise;
  wechatReady.promise = (async () => {
    await loadScript('https://res.wx.qq.com/open/js/jweixin-1.6.0.js');
    const res = await fetch(`api/wechat-config?url=${encodeURIComponent(location.href.split('#')[0])}`);
    if (!res.ok) throw new Error('WeChat signature failed');
    const cfg = await res.json();
    await new Promise((resolve, reject) => {
      wx.config({ ...cfg, jsApiList: ['getLocation', 'openLocation'] });
      wx.ready(resolve);
      wx.error(reject);
    });
  })();
  return wechatReady.promise;
}

function wechatLocation() {
  return new Promise((resolve, reject) =>
    wx.getLocation({ type: 'gcj02', success: (r) => resolve([r.longitude, r.latitude]), fail: reject, cancel: reject }),
  );
}

function browserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is not supported on this device'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(wgs84ToGcj02(p.coords.longitude, p.coords.latitude)),
      reject,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  });
}

function placeMe(pos) {
  state.here = pos;
  state.view.setMe(pos);
}

async function locate() {
  let pos;
  try {
    if (isWeChat && state.config.wechat) {
      await wechatReady();
      pos = await wechatLocation();
    } else {
      pos = await browserLocation();
    }
  } catch {
    toast('Could not get your location — allow location access, or pan the map to search an area.', 4000);
    return null;
  }
  placeMe(pos);
  state.view.setView(pos, 15);
  return pos;
}

function watchLocation() {
  if (isWeChat || !navigator.geolocation) return;
  navigator.geolocation.watchPosition(
    (p) => placeMe(wgs84ToGcj02(p.coords.longitude, p.coords.latitude)),
    () => {},
    { enableHighAccuracy: true, maximumAge: 10000 },
  );
}

// ---------- search ----------

function radiusForZoom() {
  const zoom = state.view.zoom();
  if (zoom >= 16) return 1500;
  if (zoom >= 14) return 3000;
  if (zoom >= 12) return 10000;
  return 30000;
}

async function runSearch(q, [lng, lat], radius) {
  if (state.mode === 'server') {
    const params = new URLSearchParams({ q, lng, lat, radius });
    const res = await fetch(`api/search?${params}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Search failed');
    return body;
  }
  // No server: the glossary turns common searches into the words locals use.
  const keywords = lookupQuery(q) || q;
  if (state.mode === 'amap') {
    return { keywords, results: await searchAmapJs(state.view.AMap, { keywords, lng, lat, radius }) };
  }
  if (state.mode === 'tencent') {
    return { keywords, results: await searchTencent({ key: state.config.tencentKey, keywords, lng, lat, radius }) };
  }
  // Overpass gets slow over big areas, and OSM is sparse beyond city centres anyway.
  return { keywords, results: await searchOsm({ query: q, keywords, lng, lat, radius: Math.min(radius, 5000) }) };
}

async function search(q) {
  q = q.trim();
  if (!q) return;
  $('q').value = q;
  $('q').blur();
  document.querySelectorAll('#chips button').forEach((b) => b.classList.toggle('active', b.dataset.q === q));
  closeDetail();
  setSheet(true);
  setStatus(`Searching for “${escapeHtml(q)}”…`);
  await viewReady;

  // Search around whatever the map is showing, so you can pan to plan ahead.
  const seq = ++state.searchSeq;
  const center = state.view.center();
  try {
    const body = await runSearch(q, center, radiusForZoom());
    if (seq !== state.searchSeq) return; // a newer search has started
    state.results = body.results;
    renderResults(q, body);
  } catch (err) {
    if (seq !== state.searchSeq) return;
    setStatus(`Search failed: ${escapeHtml(err.message)}`, q);
  }
}

function amapSearchUrl(keyword) {
  const params = new URLSearchParams({ keyword, view: 'map', src: 'china-maps', coordinate: 'gaode', callnative: '1' });
  params.set('center', state.view.center().join(','));
  return `https://uri.amap.com/search?${params}`;
}

// The status line; in OpenStreetMap mode it links to Amap for fuller results.
function setStatus(html, keyword) {
  const more =
    state.mode === 'osm' && keyword
      ? ` <a class="more" href="${escapeHtml(amapSearchUrl(keyword))}" target="_blank" rel="noopener">More in Amap ↗</a>`
      : '';
  $('status').innerHTML = html + more;
}

function renderResults(q, body) {
  state.selected = -1;
  const { results, keywords } = body;
  const keywordNote = keywords && keywords !== q ? ` (searched “${escapeHtml(keywords)}”)` : '';
  setStatus(
    results.length
      ? `${results.length} results for “${escapeHtml(q)}”${keywordNote}`
      : `No results for “${escapeHtml(q)}”${keywordNote}. Try zooming out or another word.`,
    keywords || q,
  );

  $('results').innerHTML = results
    .map((p, i) => `
      <li data-i="${i}">
        <span class="num">${i + 1}</span>
        <div class="info">
          <div class="name-en">${escapeHtml(title(p))}</div>
          <div class="name-zh">${escapeHtml(p.name)}</div>
          <div class="meta">${[stars(p.rating), p.cost ? `¥${Math.round(p.cost)}/person` : '', escapeHtml(p.category), formatDistance(p.distance)].filter(Boolean).join(' · ')}</div>
        </div>
      </li>`)
    .join('');

  state.view.setPins(results, select);
  state.view.fit();
}

function select(i) {
  state.selected = i;
  const p = state.results[i];
  state.view.highlight(i);
  state.view.focus([p.lng, p.lat]);
  document.querySelectorAll('#results li').forEach((li) => li.classList.toggle('selected', Number(li.dataset.i) === i));
  showDetail(p);
}

// ---------- detail card ----------

function navigateUrl(p) {
  // Opens the Amap (高德地图) app if installed, otherwise Amap's mobile web.
  const to = `${p.lng},${p.lat},${encodeURIComponent(p.name)}`;
  return `https://uri.amap.com/navigation?to=${to}&mode=walk&coordinate=gaode&callnative=1&src=china-maps`;
}

function showDetail(p) {
  const rows = [
    p.category && `<p>${escapeHtml(p.category)}</p>`,
    (p.rating || p.cost) && `<p>${[stars(p.rating), p.cost ? `Avg ¥${Math.round(p.cost)} per person` : ''].filter(Boolean).join(' · ')}</p>`,
    p.hours && `<p>🕒 ${escapeHtml(p.hours)}</p>`,
    p.distance != null && `<p>📍 ${formatDistance(p.distance)} away</p>`,
    p.address && `<p>${escapeHtml(p.address)}</p>`,
  ].filter(Boolean);

  const actions = [
    `<a class="btn primary" href="${navigateUrl(p)}" target="_blank" rel="noopener">Directions</a>`,
    `<button class="btn" data-act="driver">Show driver</button>`,
    `<button class="btn" data-act="copy">Copy 中文 name</button>`,
    `<button class="btn" data-act="dianping">Reviews on Dianping</button>`,
    p.phone && `<a class="btn" href="tel:${escapeHtml(p.phone)}">Call</a>`,
    isWeChat && state.config.wechat && `<button class="btn" data-act="wxmap">Open in WeChat map</button>`,
  ].filter(Boolean);

  $('detail-body').innerHTML = `
    <h2>${escapeHtml(title(p))}</h2>
    <p class="zh">${escapeHtml(p.name)}</p>
    ${p.photo ? `<img class="photo" src="${escapeHtml(p.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
    ${rows.join('')}
    <div class="actions">${actions.join('')}</div>`;
  $('detail').hidden = false;
  $('detail').dataset.i = state.selected;
}

function closeDetail() {
  $('detail').hidden = true;
}

async function onDetailAction(act) {
  const p = state.results[Number($('detail').dataset.i)];
  if (!p) return;
  if (act === 'driver') {
    $('driver-name').textContent = p.name;
    $('driver-address').textContent = p.address;
    $('driver').hidden = false;
  } else if (act === 'copy') {
    toast((await copy(p.name)) ? 'Chinese name copied' : 'Copy failed');
  } else if (act === 'dianping') {
    openDianping(p.name);
  } else if (act === 'wxmap') {
    await wechatReady();
    wx.openLocation({ latitude: p.lat, longitude: p.lng, name: p.name, address: p.address, scale: 16 });
  }
}

// ---------- Dianping ----------

// Dianping has no public API or documented search link, so copy the Chinese
// text and open the app for the user to paste it. Everything here must run
// synchronously inside the tap: phones block app switches and pop-ups that
// happen later.
function openDianping(text) {
  copy(text);
  toast('Copied “' + text + '” — paste it into Dianping’s search box', 4000);
  // If the app isn't installed the page stays visible; fall back to the mobile site.
  const fallback = setTimeout(() => {
    if (document.visibilityState === 'visible') location.href = 'https://m.dianping.com/';
  }, 1500);
  document.addEventListener('visibilitychange', () => clearTimeout(fallback), { once: true });
  location.href = 'dianping://';
}

// ---------- sheet & controls ----------

function setSheet(open) {
  document.body.classList.toggle('sheet-collapsed', !open);
}

function bindUi() {
  $('search').addEventListener('submit', (e) => {
    e.preventDefault();
    search($('q').value);
  });
  $('chips').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) search(b.dataset.q);
  });
  $('results').addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (li) select(Number(li.dataset.i));
  });
  $('handle').addEventListener('click', () => setSheet(document.body.classList.contains('sheet-collapsed')));
  $('locate').addEventListener('click', () => state.view && locate());
  $('lang').addEventListener('click', () => state.view && ($('lang').textContent = state.view.toggleLang()));
  $('detail-close').addEventListener('click', closeDetail);
  $('detail').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b) onDetailAction(b.dataset.act);
  });
  $('driver-close').addEventListener('click', () => ($('driver').hidden = true));
}

// ---------- boot ----------

async function main() {
  bindUi();
  setSheet(false);
  Object.assign(state, await loadConfig());
  if (state.mode === 'osm') {
    setStatus('Search for anything nearby — in English. Places come from OpenStreetMap, so smaller spots may be missing.');
  }
  state.view = await createView();
  state.view.onBackgroundClick(closeDetail);
  markViewReady();
  await locate();
  watchLocation();
}

main().catch((err) => {
  console.error(err);
  $('status').textContent = `Something went wrong: ${err.message}`;
});
