import test from 'node:test';
import assert from 'node:assert/strict';
import { searchAround, AmapError } from '../lib/amap.js';

const sample = {
  status: '1',
  pois: [
    {
      id: 'B0FFG',
      name: '海底捞火锅(人民广场店)',
      location: '121.475,31.231',
      type: '餐饮服务;中餐厅;火锅店',
      cityname: '上海市',
      adname: '黄浦区',
      address: '西藏中路1号',
      distance: '120',
      business: { rating: '4.6', cost: '128.00', tel: '021-1234;021-5678', opentime_today: '10:00-02:00' },
      photos: [{ url: 'https://example.com/a.jpg' }],
    },
    { id: 'bad', name: 'no location', location: [] },
  ],
};

test('builds the request and normalises results', async () => {
  let requested;
  const fetchImpl = async (url) => {
    requested = new URL(url);
    return { ok: true, json: async () => sample };
  };
  const pois = await searchAround({ key: 'K', keywords: '火锅', lng: 121.47, lat: 31.23, fetchImpl });
  assert.equal(requested.searchParams.get('location'), '121.47,31.23');
  assert.equal(requested.searchParams.get('keywords'), '火锅');
  assert.equal(pois.length, 1);
  assert.deepEqual(
    { ...pois[0] },
    {
      id: 'B0FFG', name: '海底捞火锅(人民广场店)', nameEn: '', category: 'Hotpot', type: '餐饮服务;中餐厅;火锅店',
      address: '上海市 黄浦区 西藏中路1号', lng: 121.475, lat: 31.231, distance: 120, rating: 4.6, cost: 128,
      phone: '021-1234', hours: '10:00-02:00', tags: '', photo: 'https://example.com/a.jpg',
    },
  );
});

test('surfaces AMap error responses', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ status: '0', infocode: '10001', info: 'INVALID_USER_KEY' }) });
  await assert.rejects(searchAround({ key: 'x', keywords: 'a', lng: 1, lat: 1, fetchImpl }), AmapError);
});
