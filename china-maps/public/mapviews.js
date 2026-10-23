// Two interchangeable map views with the same small interface. Positions are
// always [lng, lat] in GCJ-02, the system used by every map in mainland China.
//
//   center() / zoom() / setView(pos, zoom) / focus(pos)
//   setMe(pos) / setPins(places, onSelect) / highlight(i) / fit()
//   onBackgroundClick(fn) / toggleLang() -> new button label

const pinHtml = (i, selected) => `<div class="pin${selected ? ' selected' : ''}"><span>${i + 1}</span></div>`;
const ME_HTML = '<div class="me"></div>';
// Keep pins clear of the search bar (top) and the results sheet (bottom).
const sheetHeight = () => Math.round(window.innerHeight * 0.4);
// focus() puts a place this far above centre, clear of the detail card.
const focusOffset = () => Math.round(window.innerHeight * 0.25);

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}

// ---------- AMap JS API (needs a key) ----------

export async function createAmapView(el, { key, securityConfig, center }) {
  window._AMapSecurityConfig = securityConfig;
  await loadScript(`https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`);
  const AMap = window.AMap;
  const map = new AMap.Map(el, { zoom: 15, center, lang: 'en', resizeEnable: true });
  let me = null;
  let pins = [];
  let selected = -1;
  let bilingual = false;

  return {
    AMap,
    langLabel: 'EN',
    center: () => [map.getCenter().getLng(), map.getCenter().getLat()],
    zoom: () => map.getZoom(),
    setView: (pos, zoom) => map.setZoomAndCenter(zoom, pos),
    focus(pos) {
      map.setCenter(pos, true);
      map.panBy(0, -focusOffset());
    },
    setMe(pos) {
      if (me) return me.setPosition(pos);
      me = new AMap.Marker({ position: pos, content: ME_HTML, offset: new AMap.Pixel(-9, -9), zIndex: 200 });
      map.add(me);
    },
    setPins(places, onSelect) {
      map.remove(pins);
      selected = -1;
      pins = places.map((p, i) => {
        const m = new AMap.Marker({ position: [p.lng, p.lat], content: pinHtml(i), offset: new AMap.Pixel(-13, -30), zIndex: 100 });
        m.on('click', () => onSelect(i));
        return m;
      });
      map.add(pins);
    },
    highlight(i) {
      if (pins[selected]) {
        pins[selected].setContent(pinHtml(selected));
        pins[selected].setzIndex(100);
      }
      selected = i;
      pins[i].setContent(pinHtml(i, true));
      pins[i].setzIndex(150);
    },
    fit() {
      if (pins.length) map.setFitView([...pins, ...(me ? [me] : [])], false, [140, sheetHeight(), 40, 40]);
    },
    onBackgroundClick: (fn) => map.on('click', fn),
    toggleLang() {
      // English labels, or bilingual (handy for matching street signs).
      bilingual = !bilingual;
      map.setLang(bilingual ? 'zh_en' : 'en');
      return bilingual ? '中/EN' : 'EN';
    },
  };
}

// ---------- Leaflet + AMap's public tiles (no key) ----------

const TILE_URL = 'https://webrd0{s}.is.autonavi.com/appmaptile?lang={lang}&size=1&scale=1&style=8&x={x}&y={y}&z={z}';

export async function createLeafletView(el, { center, attribution }) {
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'vendor/leaflet.css';
  document.head.appendChild(css);
  await loadScript('vendor/leaflet.js');
  const L = window.L;

  // AMap's tiles are drawn in GCJ-02, so GCJ-02 positions line up with them as-is.
  const ll = ([lng, lat]) => [lat, lng];
  const map = L.map(el, { zoomControl: false, attributionControl: true }).setView(ll(center), 15);
  const tiles = L.tileLayer(TILE_URL, {
    subdomains: '1234',
    maxZoom: 18,
    lang: 'en',
    attribution,
  }).addTo(map);
  const icon = (html, size, anchor) => L.divIcon({ className: '', html, iconSize: size, iconAnchor: anchor });
  let me = null;
  let pins = [];
  let selected = -1;
  let chinese = false;

  return {
    langLabel: 'EN',
    center: () => [map.getCenter().lng, map.getCenter().lat],
    zoom: () => map.getZoom(),
    setView: (pos, zoom) => map.setView(ll(pos), zoom),
    focus(pos) {
      map.panTo(ll(pos), { animate: false });
      map.panBy([0, focusOffset()]);
    },
    setMe(pos) {
      if (me) return me.setLatLng(ll(pos));
      me = L.marker(ll(pos), { icon: icon(ME_HTML, [18, 18], [9, 9]), zIndexOffset: 2000, interactive: false }).addTo(map);
    },
    setPins(places, onSelect) {
      pins.forEach((m) => m.remove());
      selected = -1;
      pins = places.map((p, i) =>
        L.marker(ll([p.lng, p.lat]), { icon: icon(pinHtml(i), [26, 26], [13, 30]) })
          .on('click', () => onSelect(i))
          .addTo(map),
      );
    },
    highlight(i) {
      if (pins[selected]) pins[selected].setIcon(icon(pinHtml(selected), [26, 26], [13, 30])).setZIndexOffset(0);
      selected = i;
      pins[i].setIcon(icon(pinHtml(i, true), [26, 26], [13, 30])).setZIndexOffset(1000);
    },
    fit() {
      const all = [...pins, ...(me ? [me] : [])];
      if (pins.length) map.fitBounds(L.featureGroup(all).getBounds(), { paddingTopLeft: [40, 140], paddingBottomRight: [40, sheetHeight()], maxZoom: 17 });
    },
    onBackgroundClick: (fn) => map.on('click', fn),
    toggleLang() {
      // These tiles come in English or Chinese only.
      chinese = !chinese;
      tiles.options.lang = chinese ? 'zh_cn' : 'en';
      tiles.redraw();
      return chinese ? '中文' : 'EN';
    },
  };
}
