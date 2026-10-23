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

import { buildTencentUrl, normalizeTencentPoi, searchTencent } from '../public/places.js';

test('Tencent URL uses a nearby boundary capped at 1000 m and JSONP', () => {
  const url = new URL(buildTencentUrl({ key: 'K', keywords: '火锅', lng: 121.4737, lat: 31.2304, radius: 3000, callback: 'cb1' }));
  assert.equal(url.origin + url.pathname, 'https://apis.map.qq.com/ws/place/v1/search');
  assert.equal(url.searchParams.get('boundary'), 'nearby(31.2304,121.4737,1000,1)');
  assert.equal(url.searchParams.get('keyword'), '火锅');
  assert.equal(url.searchParams.get('output'), 'jsonp');
  assert.equal(url.searchParams.get('callback'), 'cb1');
  assert.equal(url.searchParams.get('key'), 'K');
});

test('normalises Tencent places', () => {
  const p = normalizeTencentPoi({
    id: '123', title: '海底捞火锅', address: '西藏中路1号', tel: '021-1234;021-5678', category: '美食:火锅',
    location: { lat: 31.2285, lng: 121.4755 }, _distance: 210.5, ad_info: { city: '上海市', district: '黄浦区' },
  });
  assert.deepEqual(
    [p.id, p.name, p.category, p.address, p.lng, p.lat, p.distance, p.phone],
    ['123', '海底捞火锅', 'Hotpot', '上海市 黄浦区 西藏中路1号', 121.4755, 31.2285, 210.5, '021-1234'],
  );
  assert.equal(normalizeTencentPoi({ id: 'x', title: 'no location' }), null);
});

test('searchTencent returns places and surfaces API errors', async () => {
  let builtUrl;
  const ok = async (build) => {
    builtUrl = build('cb9');
    return { status: 0, data: [{ id: '1', title: 'A', category: '娱乐休闲:洗浴推拿足疗', location: { lat: 31.23, lng: 121.47 } }] };
  };
  const results = await searchTencent({ key: 'K', keywords: '按摩', lng: 121.47, lat: 31.23, radius: 500, request: ok });
  assert.match(builtUrl, /callback=cb9/);
  assert.equal(results[0].category, 'Spa & massage');

  const bad = async () => ({ status: 311, message: 'key格式错误' });
  await assert.rejects(searchTencent({ key: 'x', keywords: 'a', lng: 1, lat: 1, radius: 10, request: bad }), /Tencent Maps error 311/);
});
