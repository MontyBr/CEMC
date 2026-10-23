import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOverpassQuery, normalizeOsmElement, normalizeAmapPoi, searchOsm } from '../public/places.js';
import { wgs84ToGcj02, gcj02ToWgs84 } from '../public/coords.js';

const SHANGHAI = { lng: 121.4737, lat: 31.2304 };

test('gcj02ToWgs84 inverts wgs84ToGcj02', () => {
  const [lng, lat] = gcj02ToWgs84(...wgs84ToGcj02(121.4692, 31.2286));
  assert.ok(Math.abs(lng - 121.4692) < 1e-6 && Math.abs(lat - 31.2286) < 1e-6);
});

test('Overpass query uses tag filters for known categories and WGS-84 coordinates', () => {
  const q = buildOverpassQuery({ query: 'hotpot', keywords: '火锅', ...SHANGHAI, radius: 1500 });
  const [wLng, wLat] = gcj02ToWgs84(SHANGHAI.lng, SHANGHAI.lat);
  assert.match(q, /^\[out:json\]\[timeout:25\];\(/);
  assert.ok(q.includes(`(around:1500,${wLat.toFixed(6)},${wLng.toFixed(6)})`));
  assert.ok(q.includes('["amenity"="restaurant"]["cuisine"~"hot_?pot",i]'));
  assert.ok(q.includes('["name"~"火锅",i]') && q.includes('["name:en"~"hotpot",i]'));
  assert.match(q, /out center tags 150;$/);
});

test('Overpass query falls back to name search and escapes regex characters', () => {
  const q = buildOverpassQuery({ query: 'M&M "World" (1)', keywords: 'M&M "World" (1)', ...SHANGHAI, radius: 800 });
  assert.ok(q.includes('["name"~"M&M \\"World\\" \\(1\\)",i]'));
  assert.ok(!q.includes('amenity'));
});

test('normalises OSM nodes and ways into GCJ-02 places', () => {
  const center = [SHANGHAI.lng, SHANGHAI.lat];
  const node = normalizeOsmElement(
    { type: 'node', id: 1, lat: 31.2286, lon: 121.4692, tags: { name: '海底捞', 'name:en': 'Haidilao', amenity: 'restaurant', cuisine: 'hot_pot;chinese', opening_hours: '10:00-02:00', phone: '+86 21 1234' } },
    center,
  );
  const [lng, lat] = wgs84ToGcj02(121.4692, 31.2286);
  assert.equal(node.id, 'node/1');
  assert.equal(node.nameEn, 'Haidilao');
  assert.equal(node.category, 'Hot pot · Restaurant');
  assert.equal(node.lng, lng);
  assert.equal(node.lat, lat);
  assert.ok(node.distance > 300 && node.distance < 550);
  assert.equal(node.hours, '10:00-02:00');

  const way = normalizeOsmElement({ type: 'way', id: 2, center: { lat: 31.23, lon: 121.47 }, tags: { name: '人民公园', leisure: 'park' } }, center);
  assert.equal(way.category, 'Park');
  assert.equal(normalizeOsmElement({ type: 'node', id: 3, lat: 1, lon: 1, tags: {} }, center), null);
});

test('normalises AMap JS API results (LngLat object, biz_ext)', () => {
  const p = normalizeAmapPoi({ id: 'B1', name: '星巴克', type: '餐饮服务;咖啡厅', location: { lng: 121.47, lat: 31.23 }, address: '南京东路', tel: '021-1', distance: 50, biz_ext: { rating: '4.5', cost: [] } });
  assert.deepEqual([p.lng, p.lat, p.category, p.rating, p.cost, p.phone], [121.47, 31.23, 'Café', 4.5, null, '021-1']);
});

test('searchOsm tries the next mirror, dedupes and sorts by distance', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(url);
    if (calls.length === 1) return { ok: false, status: 504 };
    assert.match(opts.body.get('data'), /^\[out:json\]/);
    const far = { type: 'node', id: 1, lat: 31.24, lon: 121.47, tags: { name: 'Far' } };
    const near = { type: 'node', id: 2, lat: 31.2286, lon: 121.4692, tags: { name: 'Near' } };
    return { ok: true, json: async () => ({ elements: [far, near, far] }) };
  };
  const results = await searchOsm({ query: 'x', keywords: 'x', ...SHANGHAI, radius: 1000, fetchImpl });
  assert.equal(calls.length, 2);
  assert.deepEqual(results.map((r) => r.name), ['Near', 'Far']);
});

test('searchOsm reports when every mirror fails', async () => {
  const fetchImpl = async () => { throw new Error('offline'); };
  await assert.rejects(searchOsm({ query: 'x', keywords: 'x', ...SHANGHAI, radius: 1000, fetchImpl }), /unavailable \(offline\)/);
});
