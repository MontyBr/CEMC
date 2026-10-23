import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupQuery, translateType } from '../public/glossary.js';

test('maps English searches to Chinese keywords', () => {
  assert.equal(lookupQuery('Hotpot'), '火锅');
  assert.equal(lookupQuery('foot massage'), '足疗');
  assert.equal(lookupQuery('restaurants'), '餐厅');
  assert.equal(lookupQuery('pharmacies'), '药店');
  assert.equal(lookupQuery('coffee near me'), '咖啡');
  assert.equal(lookupQuery('the best museum'), '博物馆');
});

test('passes Chinese through and returns null for unknown English', () => {
  assert.equal(lookupQuery('小笼包'), '小笼包');
  assert.equal(lookupQuery('somewhere quiet to read'), null);
  assert.equal(lookupQuery('  '), null);
});

test('translates the most specific AMap type segment', () => {
  assert.equal(translateType('餐饮服务;中餐厅;火锅店'), 'Hotpot');
  assert.equal(translateType('风景名胜;公园广场;未知'), 'Park & plaza');
  assert.equal(translateType(''), '');
});

test('translates Tencent categories, falling back to the reversed query glossary', () => {
  assert.equal(translateType('美食:中餐厅:川菜'), 'Sichuan');
  assert.equal(translateType('旅游景点:公园'), 'Park');
  assert.equal(translateType('购物:综合商场'), 'Mall');
});
