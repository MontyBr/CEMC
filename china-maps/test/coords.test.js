import test from 'node:test';
import assert from 'node:assert/strict';
import { wgs84ToGcj02, outOfChina } from '../public/coords.js';

test('shifts coordinates inside mainland China by a few hundred metres', () => {
  // People's Square, Shanghai (WGS-84)
  const [lng, lat] = wgs84ToGcj02(121.4692, 31.2286);
  assert.ok(Math.abs(lng - 121.4736) < 0.0005, `lng ${lng}`);
  assert.ok(Math.abs(lat - 31.2266) < 0.0005, `lat ${lat}`);
});

test('leaves coordinates outside China untouched', () => {
  assert.deepEqual(wgs84ToGcj02(-0.1276, 51.5072), [-0.1276, 51.5072]);
  assert.equal(outOfChina(116.4, 39.9), false);
});
