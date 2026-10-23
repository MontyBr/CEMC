import { wgs84ToGcj02 } from './coords.js';
import { lookupQuery } from './glossary.js';

const DEFAULT_CENTER = [121.4737, 31.2304]; // Shanghai, until we know where you are
const isWeChat = /MicroMessenger/i.test(navigator.userAgent);

const $ = (id) => document.getElementById(id);
const state = { config: null, map: null, me: null, here: null, markers: [], results: [], selected: -1 };

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

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
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

// ---------- map ----------

async function initMap() {
  // Requests that need the AMap security code go through our server's proxy.
  window._AMapSecurityConfig = { serviceHost: `${location.origin}/_AMapService` };
  await loadScript(`https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(state.config.amapKey)}`);
  state.map = new AMap.Map('map', { zoom: 15, center: DEFAULT_CENTER, lang: 'en', resizeEnable: true });
  state.map.on('click', closeDetail);
}

function placeMe([lng, lat]) {
  state.here = [lng, lat];
  if (!state.me) {
    state.me = new AMap.Marker({ position: state.here, content: '<div class="me"></div>', offset: new AMap.Pixel(-9, -9), zIndex: 200 });
    state.map.add(state.me);
  } else {
    state.me.setPosition(state.here);
  }
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

async function locate({ recenter = true } = {}) {
  let pos;
  try {
    if (isWeChat && state.config.wechat) {
      await wechatReady();
      pos = await wechatLocation();
    } else {
      pos = await browserLocation();
    }
  } catch (err) {
    toast('Could not get your location — allow location access, or pan the map to search an area.', 4000);
    return null;
  }
  placeMe(pos);
  if (recenter) state.map.setZoomAndCenter(15, pos);
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

async function search(q) {
  q = q.trim();
  if (!q) return;
  $('q').value = q;
  $('q').blur();
  document.querySelectorAll('#chips button').forEach((b) => b.classList.toggle('active', b.dataset.q === q));
  if (state.lite) return liteSearch(q);
  closeDetail();
  setSheet(true);

  // Search around whatever the map is showing, so you can pan to plan ahead.
  const center = state.map.getCenter();
  $('status').textContent = `Searching for “${q}”…`;
  try {
    const params = new URLSearchParams({ q, lng: center.getLng(), lat: center.getLat(), radius: radiusForZoom() });
    const res = await fetch(`api/search?${params}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Search failed');
    state.results = body.results;
    renderResults(q, body);
  } catch (err) {
    $('status').textContent = `Search failed: ${err.message}`;
  }
}

function radiusForZoom() {
  const zoom = state.map.getZoom();
  if (zoom >= 16) return 1500;
  if (zoom >= 14) return 3000;
  if (zoom >= 12) return 10000;
  return 30000;
}

function renderResults(q, body) {
  state.map.remove(state.markers);
  state.markers = [];
  state.selected = -1;

  const { results } = body;
  const keywordNote = body.keywords && body.keywords !== q ? ` (searched “${body.keywords}”)` : '';
  $('status').textContent = results.length
    ? `${results.length} results for “${q}”${keywordNote}`
    : `No results for “${q}”${keywordNote}. Try zooming out or another word.`;

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

  results.forEach((p, i) => {
    const marker = new AMap.Marker({
      position: [p.lng, p.lat],
      content: `<div class="pin"><span>${i + 1}</span></div>`,
      offset: new AMap.Pixel(-13, -30),
      title: title(p),
    });
    marker.on('click', () => select(i));
    state.markers.push(marker);
  });
  state.map.add(state.markers);
  if (state.markers.length) state.map.setFitView([...state.markers, ...(state.me ? [state.me] : [])], false, [140, 60, 60, 60]);
}

function select(i) {
  const prev = state.markers[state.selected];
  if (prev) {
    prev.setContent(`<div class="pin"><span>${state.selected + 1}</span></div>`);
    prev.setzIndex(100);
  }
  state.selected = i;
  const p = state.results[i];
  state.markers[i].setContent(`<div class="pin selected"><span>${i + 1}</span></div>`);
  state.markers[i].setzIndex(150);
  state.map.setCenter([p.lng, p.lat]);
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

// ---------- lite mode (no AMap key: hand searches to the Amap app) ----------

function amapSearchUrl(keyword) {
  const params = new URLSearchParams({ keyword, view: 'map', src: 'china-maps', coordinate: 'gaode', callnative: '1' });
  if (state.here) params.set('center', state.here.join(','));
  return `https://uri.amap.com/search?${params}`;
}

function liteSearch(q) {
  // The glossary turns common searches into the words locals use; anything
  // else goes through as typed, which Amap's English mode can also handle.
  const keyword = lookupQuery(q) || q;
  state.liteKeyword = keyword;
  $('lite-en').textContent = q;
  $('lite-zh').textContent = keyword;
  $('lite-amap').href = amapSearchUrl(keyword);
  $('lite-result').hidden = false;
}

async function startLite() {
  state.lite = true;
  document.body.classList.add('lite');
  $('lite').hidden = false;
  $('lite-amap').addEventListener('click', () => ($('lite-amap').href = amapSearchUrl(state.liteKeyword)));
  $('lite-copy').addEventListener('click', async () => toast((await copy(state.liteKeyword)) ? 'Copied' : 'Copy failed'));
  $('lite-dianping').addEventListener('click', () => openDianping(state.liteKeyword));
  try {
    state.here = await browserLocation();
    $('lite-location').textContent = '📍 Searching around your current location.';
  } catch {
    $('lite-location').textContent = '📍 Location is off, so Amap will search around wherever its map is showing.';
  }
}

// ---------- Dianping ----------

// Dianping has no public API or documented search link, so copy the Chinese
// text and open the app for the user to paste it. Everything here must run
// synchronously inside the tap: phones block app switches and pop-ups that
// happen later (the old version waited 600 ms, so nothing opened).
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
  $('locate').addEventListener('click', () => locate());
  $('lang').addEventListener('click', () => {
    // EN = English labels; 中/EN = bilingual, handy for matching street signs.
    const bilingual = $('lang').textContent === 'EN';
    state.map.setLang(bilingual ? 'zh_en' : 'en');
    $('lang').textContent = bilingual ? '中/EN' : 'EN';
  });
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
  // On static hosting (e.g. GitHub Pages) there is no API server, so run lite.
  state.config = await fetch('api/config')
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  if (!state.config?.amapKey) return startLite();
  await initMap();
  await locate();
  watchLocation();
}

main().catch((err) => {
  console.error(err);
  $('status').textContent = `Something went wrong: ${err.message}`;
});
