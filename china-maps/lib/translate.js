// Optional Claude-backed translation. Used for free-text searches the glossary
// doesn't know ("somewhere for xiaolongbao", "kids' playground") and for
// English names of the places AMap returns. Disabled when ANTHROPIC_API_KEY is unset.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5-5';
const CACHE_LIMIT = 5000;

let client = null;
const cache = new Map();

export function translationEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

function remember(key, value) {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, value);
}

async function askJson(system, content, schema) {
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content }],
  });
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
  const text = response.content.find((block) => block.type === 'text');
  return text ? JSON.parse(text.text) : null;
}

// English query -> Chinese search keywords for AMap.
export async function translateQuery(query) {
  const key = `q:${query.toLowerCase()}`;
  if (cache.has(key)) return cache.get(key);

  const result = await askJson(
    'You turn an English-speaking traveller\'s map search into the short Simplified Chinese ' +
      'keywords a local would type into Gaode Maps (AMap) to find the same kind of place. ' +
      'Prefer the common everyday term (e.g. "foot massage" -> "足疗", "soup dumplings" -> "小笼包"). ' +
      'Keep brand names in the form Chinese apps use (e.g. "Starbucks" -> "星巴克").',
    query,
    {
      type: 'object',
      properties: { keywords: { type: 'string' } },
      required: ['keywords'],
      additionalProperties: false,
    },
  );
  const keywords = result?.keywords?.trim() || null;
  if (keywords) remember(key, keywords);
  return keywords;
}

// Fills in poi.nameEn for each place, using the cache where possible.
export async function translatePlaces(pois) {
  const missing = pois.filter((p) => !cache.has(`p:${p.name}`));
  if (missing.length) {
    const result = await askJson(
      'Translate Chinese place names from a map app into natural English for a tourist. ' +
        'Use the official English name when one is well known; otherwise translate the meaning ' +
        'and keep proper nouns in pinyin (e.g. "南翔馒头店" -> "Nanxiang Steamed Bun Restaurant"). ' +
        'Return one entry per input id.',
      JSON.stringify(missing.map(({ id, name, type }) => ({ id, name, type }))),
      {
        type: 'object',
        properties: {
          places: {
            type: 'array',
            items: {
              type: 'object',
              properties: { id: { type: 'string' }, english: { type: 'string' } },
              required: ['id', 'english'],
              additionalProperties: false,
            },
          },
        },
        required: ['places'],
        additionalProperties: false,
      },
    );
    const byId = new Map((result?.places || []).map((p) => [p.id, p.english]));
    for (const poi of missing) {
      if (byId.get(poi.id)) remember(`p:${poi.name}`, byId.get(poi.id));
    }
  }
  for (const poi of pois) poi.nameEn = cache.get(`p:${poi.name}`) || poi.nameEn;
  return pois;
}
