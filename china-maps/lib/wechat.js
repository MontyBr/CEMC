// WeChat JS-SDK signing, so the page can call wx.getLocation / wx.openLocation
// when opened inside WeChat. Needs a WeChat Official Account (公众号).
import { createHash, randomBytes } from 'node:crypto';

const API = 'https://api.weixin.qq.com/cgi-bin';
let ticketCache = { ticket: null, expiresAt: 0 };

export function wechatEnabled() {
  return Boolean(process.env.WECHAT_APPID && process.env.WECHAT_SECRET);
}

export function sign({ ticket, nonceStr, timestamp, url }) {
  const raw = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url.split('#')[0]}`;
  return createHash('sha1').update(raw).digest('hex');
}

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url);
  const body = await res.json();
  if (body.errcode) throw new Error(`WeChat error ${body.errcode}: ${body.errmsg}`);
  return body;
}

async function getTicket(fetchImpl) {
  if (ticketCache.ticket && Date.now() < ticketCache.expiresAt) return ticketCache.ticket;
  const { WECHAT_APPID: appid, WECHAT_SECRET: secret } = process.env;
  const token = await getJson(
    `${API}/token?grant_type=client_credential&appid=${appid}&secret=${secret}`,
    fetchImpl,
  );
  const ticket = await getJson(
    `${API}/ticket/getticket?access_token=${token.access_token}&type=jsapi`,
    fetchImpl,
  );
  // Refresh 5 minutes early; both tokens normally last 7200s.
  ticketCache = { ticket: ticket.ticket, expiresAt: Date.now() + (ticket.expires_in - 300) * 1000 };
  return ticketCache.ticket;
}

export async function jsSdkConfig(url, fetchImpl = fetch) {
  const ticket = await getTicket(fetchImpl);
  const nonceStr = randomBytes(8).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    appId: process.env.WECHAT_APPID,
    timestamp,
    nonceStr,
    signature: sign({ ticket, nonceStr, timestamp, url }),
  };
}
