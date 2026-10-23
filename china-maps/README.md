# China Maps in English

A phone-first web app for travelling in mainland China. Search in English, see results
as numbered pins on an English-labelled AMap (高德地图) map, and get what you need to
actually get there: directions, the Chinese name to show a driver, ratings and prices.

## What it does

- **Your location on the map.** Uses the phone's GPS, or WeChat's location API when opened
  inside WeChat. GPS coordinates are converted to GCJ-02, China's offset map
  system, so the blue dot shows where you really are.
- **English map labels.** AMap's English tiles. Tap **EN** to switch to bilingual labels
  (中/EN), which helps when you are matching street signs.
- **English search.** "hotpot", "foot massage", "pharmacy", "temples" go through a built-in
  glossary of about 200 travel terms (`lib/glossary.js`). With an Anthropic API key, any
  other phrase is translated to Chinese search keywords, and the Chinese place names
  are translated to English.
- **Results overlaid on the map.** Numbered pins plus a bottom-sheet list with rating, average
  price per person, category, distance and opening hours. The app searches around the
  centre of the map, so you can pan to another neighbourhood and plan ahead.
- **Place card actions:**
  - **Directions:** opens the Amap app (or Amap mobile web).
  - **Show driver:** a full-screen card with the Chinese name and address in large type.
  - **Copy 中文 name:** copies the Chinese name for pasting into Didi, Meituan and similar apps.
  - **Reviews on Dianping:** copies the name and opens Dianping (see the Dianping note below).
  - **Call**, and **Open in WeChat map** when you are inside WeChat.

## Setup

```bash
cd china-maps
cp .env.example .env   # then fill it in
npm install
npm start              # http://localhost:3000
npm test
```

### Keys you need

1. **AMap (required).** Create an account at <https://console.amap.com>. Registering a
   developer account needs a Chinese phone number. Create two keys:
   - A **Web端 (JS API)** key. Put it in `AMAP_JS_KEY`, and put its **安全密钥** (security code)
     in `AMAP_JS_SECURITY_CODE`. The server keeps the security code private through the
     `/_AMapService` proxy, as AMap recommends.
   - A **Web服务** key for place search. Put it in `AMAP_WEB_SERVICE_KEY`.
2. **Anthropic (optional).** `ANTHROPIC_API_KEY` turns on free-text query translation and
   English place names. Without it, results show the English category ("Hotpot",
   "Museum") above the Chinese name.
3. **WeChat (optional).** `WECHAT_APPID` and `WECHAT_SECRET` from a WeChat Official Account
   (公众号). You must also add your domain under *JS接口安全域名*.

## How it works

```
phone browser / WeChat
   │  /api/search?q=hotpot&lng=…&lat=…
   ▼
server.js ── glossary or Claude ──► "火锅"
   │
   ├─► AMap Web Service  /v5/place/around  (GCJ-02 POIs, rating, cost, hours)
   └─► Claude: Chinese names → English (cached in memory)
```

| File | Purpose |
|---|---|
| `server.js` | Static files, `/api/search`, `/api/config`, `/api/wechat-config`, and the AMap security proxy |
| `lib/glossary.js` | English → Chinese search terms, and AMap category → English |
| `lib/amap.js` | AMap place search and result normalisation |
| `lib/translate.js` | Optional Claude translation of queries and place names |
| `lib/wechat.js` | WeChat JS-SDK signature, with token and ticket caching |
| `public/` | The mobile UI. Plain HTML, CSS and JS with no build step |

## Things to know before relying on it in China

- **HTTPS is required.** Phones only share location with `https://` pages (or
  `localhost`). To test on your phone during development, use a tunnel or deploy behind TLS.
- **Hosting.** AMap's APIs work from anywhere. Inside WeChat, though, the JS-SDK only works
  on a domain with an ICP filing (备案), which means a server in mainland China. Outside
  WeChat, any host works. The Anthropic API is not reachable from mainland China
  servers, so if you host there, either leave translation off or run translation from
  outside China.
- **Dianping.** Dianping (大众点评) has no public API, and its search pages require a login,
  so the app can't pull Dianping reviews or deep-link into a search. The ratings and prices
  in the app come from AMap, which carries much of the same data. The Dianping button
  copies the Chinese name and opens Dianping so you can paste it in.
- **Coverage.** AMap's POI data is in Chinese. English labels exist for the base map, but
  not for every shop name. That gap is why the glossary and the optional translation exist.
- **Your connection.** Google services are blocked in mainland China, but AMap, WeChat and
  Dianping all work on local SIMs and Wi-Fi. A roaming SIM or eSIM routes traffic through
  your home carrier and works too.

## Ideas for next steps

- Save favourites and an itinerary per day (localStorage, or a WeChat Mini Program).
- Walking and transit route lines drawn on the map (AMap `Walking` / `Transfer` plugins).
- A phrase card for each category, for example "Is there an English menu?" for restaurants.
- Add to home screen as a PWA, with a manifest and offline caching of the glossary.
