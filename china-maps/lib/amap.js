// AMap (Gaode) Web Service place search. All coordinates are GCJ-02,
// the same system the AMap JS map uses, so results can be plotted directly.
import { normalizeAmapPoi } from '../public/places.js';

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
  return (body.pois || []).map(normalizeAmapPoi).filter(Boolean);
}
