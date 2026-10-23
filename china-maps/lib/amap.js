// AMap (Gaode) Web Service place search. All coordinates are GCJ-02,
// the same system the AMap JS map uses, so results can be plotted directly.
import { translateType } from '../public/glossary.js';

const AROUND_URL = 'https://restapi.amap.com/v5/place/around';

export class AmapError extends Error {}

export async function searchAround({ key, keywords, lng, lat, radius = 3000, page = 1, fetchImpl = fetch }) {
  const params = new URLSearchParams({
    key,
    keywords,
    location: `${lng},${lat}`,
    radius: String(Math.min(Math.max(radius, 100), 50000)),
    sortrule: 'distance',
    page_size: '25',
    page_num: String(page),
    show_fields: 'business,photos',
  });
  const res = await fetchImpl(`${AROUND_URL}?${params}`);
  if (!res.ok) throw new AmapError(`AMap HTTP ${res.status}`);
  const body = await res.json();
  if (body.status !== '1') throw new AmapError(`AMap error ${body.infocode}: ${body.info}`);
  return (body.pois || []).map(normalizePoi).filter(Boolean);
}

// AMap returns [] instead of "" for empty fields; flatten those to strings.
function str(value) {
  return Array.isArray(value) ? value.join('') : value == null ? '' : String(value);
}

function num(value) {
  const n = parseFloat(str(value));
  return Number.isFinite(n) ? n : null;
}

export function normalizePoi(poi) {
  const [lng, lat] = str(poi.location).split(',').map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const biz = poi.business || {};
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
    phone: str(biz.tel).split(';')[0],
    hours: str(biz.opentime_today) || str(biz.opentime_week),
    tags: str(biz.tag),
    photo: (poi.photos && poi.photos[0] && str(poi.photos[0].url)) || '',
  };
}
