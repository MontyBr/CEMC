import test from 'node:test';
import assert from 'node:assert/strict';
import { sign } from '../lib/wechat.js';

test('matches the signature example from the WeChat JS-SDK docs', () => {
  const signature = sign({
    ticket: 'sM4AOVdWfPE4DxkXGEs8VMCPGGVi4C3VM0P37wVUCFvkVAy_90u5h9nbSlYy3-Sl-HhTdfl2fzFy1AOcHKP7qg',
    nonceStr: 'Wm3WZYTPz0wzccnW',
    timestamp: 1414587457,
    url: 'http://mp.weixin.qq.com?params=value#ignored',
  });
  assert.equal(signature, '0f9de62fce790f9a083d5c99e95740ceb90c27ed');
});
