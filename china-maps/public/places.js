// Place search backends that run in the browser, plus the normaliser shared
// with the server. Every place comes out in the same shape, in GCJ-02.
import { translateType } from './glossary.js';
import { wgs84ToGcj02, gcj02ToWgs84, distanceMeters } from './coords.js';

// ---------- AMap ----------

// AMap returns [] instead of "" for empty fields; flatten those to strings.
function str(value) {
  return Array.isArray(value) ? value.join('') : value == null ? '' : String(value);
}

function num(value) {
  const n = parseFloat(str(value));
  return Number.isFinite(n) ? n : null;
}

// Handles both the Web Service API (location "lng,lat", `business`) and the
// JS API PlaceSearch plugin (location LngLat object, `biz_ext`).
export function normalizeAmapPoi(poi) {
  const loc = poi.location;
  const [lng, lat] =
    loc && typeof loc === 'object' && !Array.isArray(loc)
      ? [Number(loc.lng), Number(loc.lat)]
      : str(loc).split(',').map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const biz = poi.business || poi.biz_ext || {};
  return {
    id: str(poi.id),
    name: str(poi.name),
    nameEn: '',
    category: translateType(poi.type),
    type: str(poi.type),
    address: [str(poi.cityname), str(poi.adname), str(poi.address)].filter(Boolean).join(' '),
    lng,
    lat,
    distance: num(poi.distance),
    rating: num(biz.rating),
    cost: num(biz.cost),
    phone: str(biz.tel || poi.tel).split(';')[0],
    hours: str(biz.opentime_today) || str(biz.opentime_week) || str(biz.open_time),
    tags: str(biz.tag),
    photo: (poi.photos && poi.photos[0] && str(poi.photos[0].url)) || '',
  };
}

// AMap JS API (key + security code in the page, no server needed).
export function searchAmapJs(AMap, { keywords, lng, lat, radius }) {
  return new Promise((resolve, reject) => {
    AMap.plugin('AMap.PlaceSearch', () => {
      const search = new AMap.PlaceSearch({ pageSize: 25, pageIndex: 1, extensions: 'all' });
      search.searchNearBy(keywords, [lng, lat], radius, (status, result) => {
        if (status === 'no_data') return resolve([]);
        if (status !== 'complete') return reject(new Error(typeof result === 'string' ? result : 'AMap search failed'));
        resolve(result.poiList.pois.map(normalizeAmapPoi).filter(Boolean));
      });
    });
  });
}

// ---------- Tencent Maps (腾讯位置服务) WebService API ----------

const TENCENT_SEARCH_URL = 'https://apis.map.qq.com/ws/place/v1/search';
// Tencent's "nearby" search only accepts a radius of 10–1000 m; auto_extend
// widens it when nothing is found that close.
const TENCENT_MAX_RADIUS = 1000;

export function buildTencentUrl({ key, keywords, lng, lat, radius, callback }) {
  const r = Math.min(Math.max(Math.round(radius), 10), TENCENT_MAX_RADIUS);
  const params = new URLSearchParams({
    key,
    keyword: keywords,
    boundary: `nearby(${lat},${lng},${r},1)`,
    orderby: '_distance',
    page_size: '20',
    page_index: '1',
    output: 'jsonp',
    callback,
  });
  return `${TENCENT_SEARCH_URL}?${params}`;
}

export function normalizeTencentPoi(poi) {
  const lng = Number(poi.location?.lng);
  const lat = Number(poi.location?.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || !poi.title) return null;
  const ad = poi.ad_info || {};
  return {
    id: String(poi.id),
    name: poi.title,
    nameEn: '',
    category: translateType(poi.category),
    type: poi.category || '',
    address: [ad.city, ad.district, poi.address].filter(Boolean).join(' '),
    lng,
    lat,
    distance: Number.isFinite(poi._distance) ? poi._distance : null,
    rating: null,
    cost: null,
    phone: String(poi.tel || '').split(';')[0].trim(),
    hours: '',
    tags: '',
    photo: '',
  };
}

// Tencent's WebService API allows browser calls through JSONP (with the
// site's domain whitelisted on the key), so no server is needed.
let jsonpCount = 0;
function jsonp(buildUrl, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const callback = `__tencentCb${++jsonpCount}`;
    const script = document.createElement('script');
    const done = () => {
      clearTimeout(timer);
      delete window[callback];
      script.remove();
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error('Tencent Maps did not respond'));
    }, timeoutMs);
    window[callback] = (data) => {
      done();
      resolve(data);
    };
    script.onerror = () => {
      done();
      reject(new Error('Could not reach Tencent Maps'));
    };
    script.src = buildUrl(callback);
    document.head.appendChild(script);
  });
}

export async function searchTencent({ key, keywords, lng, lat, radius, request = jsonp }) {
  const body = await request((callback) => buildTencentUrl({ key, keywords, lng, lat, radius, callback }));
  if (body.status !== 0) throw new Error(`Tencent Maps error ${body.status}: ${body.message}`);
  return (body.data || []).map(normalizeTencentPoi).filter(Boolean);
}

// ---------- OpenStreetMap (Overpass API) ----------

// Glossary keyword (Chinese) -> Overpass tag filters. Anything not listed is
// found by name instead (which also covers brands like 星巴克 / Starbucks).
const RESTAURANT = '["amenity"="restaurant"]';
const cuisine = (re) => `${RESTAURANT}["cuisine"~"${re}",i]`;
const OSM_FILTERS = {
  餐厅: [RESTAURANT],
  美食: [RESTAURANT, '["amenity"~"^(fast_food|food_court)$"]'],
  中餐厅: [cuisine('chinese|sichuan|cantonese|hunan|shanghai|regional')],
  西餐厅: [cuisine('western|french|italian|steak|american|european')],
  火锅: [cuisine('hot_?pot')],
  饺子: [cuisine('dumpling')],
  小笼包: [cuisine('dumpling')],
  面馆: [cuisine('noodle|ramen')],
  牛肉面: [cuisine('noodle|ramen')],
  北京烤鸭: [cuisine('duck|peking')],
  烤鸭: [cuisine('duck|peking')],
  烧烤: [cuisine('barbecue|bbq|grill')],
  烤串: [cuisine('barbecue|bbq|kebab')],
  早茶: [cuisine('dim_sum|cantonese')],
  川菜: [cuisine('sichuan')],
  粤菜: [cuisine('cantonese')],
  湘菜: [cuisine('hunan')],
  素食: ['["diet:vegetarian"~"^(yes|only)$"]', '["diet:vegan"~"^(yes|only)$"]', cuisine('vegetarian|vegan')],
  清真: ['["diet:halal"~"^(yes|only)$"]', cuisine('halal|muslim|uyghur|xinjiang')],
  海鲜: [cuisine('seafood|fish')],
  早餐: [cuisine('breakfast')],
  面包店: ['["shop"="bakery"]'],
  甜品: ['["shop"~"^(pastry|confectionery)$"]', '["amenity"="ice_cream"]', '["cuisine"~"dessert",i]'],
  冰淇淋: ['["amenity"="ice_cream"]'],
  咖啡: ['["amenity"="cafe"]'],
  咖啡厅: ['["amenity"="cafe"]'],
  茶馆: ['["amenity"="cafe"]["cuisine"~"tea",i]', '["shop"="tea"]'],
  奶茶: ['["cuisine"~"bubble_tea|tea",i]'],
  酒吧: ['["amenity"~"^(bar|pub|biergarten)$"]'],
  精酿啤酒: ['["amenity"~"^(bar|pub|biergarten)$"]'],
  披萨: [cuisine('pizza')],
  汉堡: ['["cuisine"~"burger",i]'],
  寿司: ['["cuisine"~"sushi|japanese",i]'],
  日本料理: ['["cuisine"~"japanese|sushi|ramen",i]'],
  韩国料理: [cuisine('korean')],
  泰国菜: [cuisine('thai')],
  印度菜: [cuisine('indian')],
  意大利餐厅: [cuisine('italian|pizza')],
  水疗: ['["leisure"="spa"]', '["amenity"="spa"]', '["shop"="massage"]'],
  按摩: ['["shop"="massage"]', '["leisure"="spa"]', '["amenity"="massage"]'],
  足疗: ['["shop"="massage"]', '["leisure"="spa"]'],
  足浴: ['["shop"="massage"]', '["leisure"="spa"]'],
  推拿: ['["shop"="massage"]', '["healthcare"]["healthcare:speciality"~"massage|tcm",i]'],
  汗蒸: ['["leisure"="sauna"]', '["amenity"="public_bath"]'],
  洗浴中心: ['["amenity"="public_bath"]', '["leisure"="sauna"]'],
  美甲: ['["shop"="beauty"]'],
  美发: ['["shop"="hairdresser"]'],
  理发: ['["shop"="hairdresser"]'],
  理发店: ['["shop"="hairdresser"]'],
  健身房: ['["leisure"="fitness_centre"]'],
  瑜伽: ['["sport"="yoga"]'],
  购物: ['["shop"~"^(mall|department_store)$"]'],
  购物中心: ['["shop"~"^(mall|department_store)$"]'],
  百货: ['["shop"="department_store"]'],
  市场: ['["amenity"="marketplace"]'],
  夜市: ['["amenity"="marketplace"]'],
  菜市场: ['["amenity"="marketplace"]'],
  超市: ['["shop"="supermarket"]'],
  便利店: ['["shop"="convenience"]'],
  药店: ['["amenity"="pharmacy"]', '["shop"="chemist"]'],
  书店: ['["shop"="books"]'],
  电子产品: ['["shop"~"^(electronics|mobile_phone|computer)$"]'],
  手机店: ['["shop"="mobile_phone"]'],
  中国移动营业厅: ['["shop"="mobile_phone"]'],
  纪念品: ['["shop"~"^(gift|souvenir|art|antiques)$"]'],
  丝绸: ['["shop"~"^(fabric|clothes)$"]["name"~"丝"]'],
  茶叶店: ['["shop"="tea"]'],
  裁缝: ['["shop"="tailor"]'],
  服装店: ['["shop"~"^(clothes|boutique|fashion)$"]'],
  鞋店: ['["shop"="shoes"]'],
  景点: ['["tourism"~"^(attraction|museum|viewpoint|gallery|zoo|theme_park|aquarium)$"]', '["historic"]["name"]'],
  风景名胜: ['["tourism"~"^(attraction|viewpoint)$"]', '["historic"]["name"]'],
  寺庙: ['["amenity"="place_of_worship"]["religion"~"^(buddhist|taoist|confucian|chinese_folk)$"]'],
  博物馆: ['["tourism"="museum"]'],
  公园: ['["leisure"="park"]["name"]'],
  园林: ['["leisure"="garden"]["name"]'],
  动物园: ['["tourism"="zoo"]'],
  海洋馆: ['["tourism"="aquarium"]'],
  游乐园: ['["tourism"="theme_park"]'],
  观景台: ['["tourism"="viewpoint"]'],
  海滩: ['["natural"="beach"]'],
  剧院: ['["amenity"="theatre"]'],
  电影院: ['["amenity"="cinema"]'],
  KTV: ['["amenity"="karaoke_box"]'],
  夜店: ['["amenity"="nightclub"]'],
  密室逃脱: ['["leisure"="escape_game"]'],
  美术馆: ['["tourism"="gallery"]', '["amenity"="arts_centre"]'],
  教堂: ['["amenity"="place_of_worship"]["religion"="christian"]'],
  清真寺: ['["amenity"="place_of_worship"]["religion"="muslim"]'],
  酒店: ['["tourism"="hotel"]'],
  青年旅舍: ['["tourism"="hostel"]'],
  ATM: ['["amenity"="atm"]', '["amenity"="bank"]["atm"="yes"]'],
  银行: ['["amenity"="bank"]'],
  外币兑换: ['["amenity"="bureau_de_change"]'],
  公共厕所: ['["amenity"="toilets"]'],
  医院: ['["amenity"="hospital"]'],
  国际医院: ['["amenity"="hospital"]'],
  诊所: ['["amenity"~"^(clinic|doctors)$"]'],
  牙科: ['["amenity"="dentist"]'],
  派出所: ['["amenity"="police"]'],
  地铁站: ['["station"="subway"]', '["railway"="station"]["subway"="yes"]'],
  公交站: ['["highway"="bus_stop"]'],
  火车站: ['["railway"="station"]["train"="yes"]'],
  机场: ['["aeroway"="aerodrome"]'],
  停车场: ['["amenity"="parking"]'],
  加油站: ['["amenity"="fuel"]'],
  充电站: ['["amenity"="charging_station"]'],
  邮局: ['["amenity"="post_office"]'],
  洗衣店: ['["shop"~"^(laundry|dry_cleaning)$"]'],
};

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// Escapes text for use inside an Overpass "..." regex.
function overpassRegex(text) {
  return text.replace(/[\\^$.*+?()[\]{}|"]/g, '\\$&');
}

// query: what the user typed; keywords: the glossary's Chinese for it (or the same text).
export function buildOverpassQuery({ query, keywords, lng, lat, radius }) {
  const [wLng, wLat] = gcj02ToWgs84(lng, lat); // OSM data is WGS-84
  const around = `(around:${Math.round(radius)},${wLat.toFixed(6)},${wLng.toFixed(6)})`;
  const filters = OSM_FILTERS[keywords] || [];
  const names = [...new Set([keywords, query].map((s) => s.trim()).filter((s) => s.length >= 2))];
  const statements = [
    ...filters.map((f) => `nwr${around}${f};`),
    ...names.map((n) => `nwr${around}["name"~"${overpassRegex(n)}",i];`),
    ...names.map((n) => `nwr${around}["name:en"~"${overpassRegex(n)}",i];`),
  ];
  return `[out:json][timeout:25];(${statements.join('')});out center tags 150;`;
}

const pretty = (s) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function osmCategory(t) {
  const kind = t.amenity || t.shop || t.tourism || t.leisure || t.historic || t.railway || t.healthcare || '';
  const base = kind === 'yes' ? '' : pretty(kind);
  const food = t.cuisine ? pretty(t.cuisine.split(';')[0]) : '';
  return [food, base].filter(Boolean).join(' · ') || 'Place';
}

export function normalizeOsmElement(el, center) {
  const t = el.tags || {};
  const wLat = el.lat ?? el.center?.lat;
  const wLng = el.lon ?? el.center?.lon;
  const name = t.name || t['name:zh'] || t['name:en'];
  if (wLat == null || wLng == null || !name) return null;
  const [lng, lat] = wgs84ToGcj02(wLng, wLat);
  const address = [t['addr:city'], t['addr:district'], t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
  return {
    id: `${el.type}/${el.id}`,
    name,
    nameEn: t['name:en'] && t['name:en'] !== name ? t['name:en'] : '',
    category: osmCategory(t),
    type: '',
    address,
    lng,
    lat,
    distance: center ? distanceMeters(center, [lng, lat]) : null,
    rating: null,
    cost: null,
    phone: (t.phone || t['contact:phone'] || '').split(';')[0],
    hours: t.opening_hours || '',
    tags: '',
    photo: '',
  };
}

export async function searchOsm({ query, keywords, lng, lat, radius, fetchImpl = fetch }) {
  const body = new URLSearchParams({ data: buildOverpassQuery({ query, keywords, lng, lat, radius }) });
  let lastError;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetchImpl(url, { method: 'POST', body, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const seen = new Set();
      return data.elements
        .map((el) => normalizeOsmElement(el, [lng, lat]))
        .filter((p) => p && !seen.has(p.id) && seen.add(p.id))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 40);
    } catch (err) {
      lastError = err; // try the next mirror
    }
  }
  throw new Error(`OpenStreetMap search is unavailable (${lastError?.message})`);
}
