const fs = require('fs');
const path = require('path');

const GEOJSON_PATH = 'data.geojson';
const CACHE_DIR = '.cache';
const CACHE_FILE = path.join(CACHE_DIR, 'translations.json');
const TARGET_FILE = 'pirmas';
const LIBRE_URL = process.env.LIBRETRANSLATE_URL || 'https://libretranslate.com/translate';

async function translateText(text, target) {
  try {
    const fetch = (await import('node-fetch')).default;
    const res = await fetch(LIBRE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, source: 'lt', target, format: 'text' })
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j.translatedText || null;
  } catch (e) {
    console.warn('Translation error:', e.message);
    return null;
  }
}

function getFeatureName(props) {
  if (!props) return null;
  const candidates = ['name', 'Name', 'pavadinimas', 'PAV', 'PAVADINIMAS', 'pav', 'title'];
  for (const k of candidates) {
    if (props[k] && typeof props[k] === 'string') return props[k].trim();
  }
  return null;
}

function isParapijosCentras(props) {
  if (!props) return false;
  const keywords = ['parapijos centras', 'Parapijos centras', 'Parapijos', 'parapija'];
  for (const k of Object.keys(props)) {
    const v = props[k];
    if (typeof v === 'string' && keywords.some(kw => v.toLowerCase().includes(kw.toLowerCase()))) {
      return true;
    }
  }
  return false;
}

async function main() {
  if (!fs.existsSync(GEOJSON_PATH)) {
    console.log('No GeoJSON file found. Skipping update.');
    process.exit(0);
  }

  const geo = JSON.parse(fs.readFileSync(GEOJSON_PATH, 'utf8'));
  if (!geo.features) {
    console.log('No features found in GeoJSON.');
    process.exit(0);
  }

  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);
  let cache = {};
  if (fs.existsSync(CACHE_FILE)) {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  }

  const features = geo.features.filter(f => isParapijosCentras(f.properties));
  console.log(`Found ${features.length} Parapijos centras features`);

  const namesMap = new Map();
  for (const f of features) {
    const name = getFeatureName(f.properties);
    if (name) namesMap.set(name, { lt: name, de: null, ru: null });
  }

  // Translate names
  for (const [lt, obj] of namesMap) {
    if (cache[lt]) {
      obj.de = cache[lt].de || lt;
      obj.ru = cache[lt].ru || lt;
    } else {
      const de = await translateText(lt, 'de');
      const ru = await translateText(lt, 'ru');
      obj.de = de || lt;
      obj.ru = ru || lt;
      cache[lt] = { de: obj.de, ru: obj.ru };
      await new Promise(r => setTimeout(r, 300));
    }
  }

  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));

  const timestamp = new Date().toISOString();
  const header = `\n## Parapijos centras (Extracted ${timestamp})\nGerman | Lithuanian | Russian\n`;
  const lines = [header];
  let i = 1;
  for (const [lt, obj] of namesMap) {
    lines.push(`${i}. ${obj.de} | ${obj.lt} | ${obj.ru}`);
    i++;
  }
  const block = lines.join('\n') + '\n';

  let content = '';
  if (fs.existsSync(TARGET_FILE)) {
    content = fs.readFileSync(TARGET_FILE, 'utf8');
  }

  // Remove old Parapijos section if present
  const idx = content.indexOf('## Parapijos centras');
  const newContent = (idx === -1 ? content : content.slice(0, idx)) + block;

  fs.writeFileSync(TARGET_FILE, newContent, 'utf8');
  console.log(`Updated ${TARGET_FILE} with ${namesMap.size} placenames`);
}

main().catch(err => { console.error(err); process.exit(1); });
