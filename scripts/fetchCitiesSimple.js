#!/usr/bin/env node
/*
  Simple major-cities fetcher (Natural Earth only).
  - Downloads Natural Earth 10m populated places (cached locally)
  - Filters by ISO3 (ADM0_A3/ISO_A3/SOV_A3 fallbacks)
  - Sorts by POP_MAX, applies optional min population
  - Writes top N to geolayers-game/public/data/<ISO3>/cities.geojson

  Usage:
    node scripts/fetchCitiesSimple.js                 # all ISO3 in countries.json
    node scripts/fetchCitiesSimple.js USA MEX         # specific ISO3
    node scripts/fetchCitiesSimple.js --limit=20 --min-pop=100000
    node scripts/fetchCitiesSimple.js BRA --refresh-ne --limit=25
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'geolayers-game', 'public', 'data');
const COUNTRIES_FILE = path.join(ROOT, 'geolayers-game', 'public', 'countries.json');

const NE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson';
const NE_CACHE = path.join(__dirname, 'ne_10m_populated_places_simple.geojson');

function readJson(p){ return JSON.parse(fs.readFileSync(p, 'utf8')); }

function getISO3List(){
  const arr = readJson(COUNTRIES_FILE);
  return arr.map(r=>r.code);
}

async function ensureNE(refresh){
  if (!refresh && fs.existsSync(NE_CACHE)) return;
  const r = await fetch(NE_URL);
  if(!r.ok){
    const t = await r.text().catch(()=>String(r.status));
    throw new Error(`NE download failed: ${r.status} ${t}`);
  }
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(NE_CACHE, buf);
}

function filterNEByISO3(ne, code){
  const rows = Array.isArray(ne?.features) ? ne.features : [];
  const ISO3 = String(code||'').toUpperCase();
  return rows.filter(f => {
    const p = f && f.properties ? f.properties : null;
    if(!p) return false;
    const cands = [
      p.ADM0_A3, p.adm0_a3,
      p.ISO_A3,  p.iso_a3,
      p.SOV_A3,  p.sov_a3,
      p.ADM0_A3_US, p.adm0_a3_us,
      p.ADM0_A3_UN, p.adm0_a3_un,
      p.ISO_A2, p.iso_a2 // last resort
    ];
    return cands.some(v => typeof v === 'string' && v.toUpperCase() === ISO3);
  });
}

function toCityFeature(f){
  const g = f.geometry;
  if(!g || g.type !== 'Point' || !Array.isArray(g.coordinates)) return null;
  const lon = Number(g.coordinates[0]);
  const lat = Number(g.coordinates[1]);
  if(!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const p = f.properties || {};
  const pop = Number(p.POP_MAX ?? p.pop_max ?? p.POP_MIN ?? p.pop_min) || null;
  const name = p.NAME || p.name || p.NAMEASCII || p.nameascii || null;
  if(!name) return null;
  return { type:'Feature', properties:{ name, population: pop, source:'NE10m' }, geometry:{ type:'Point', coordinates:[lon,lat] } };
}

function writeCities(iso3, features){
  const dir = path.join(DATA_DIR, iso3);
  fs.mkdirSync(dir, { recursive:true });
  const file = path.join(dir, 'cities.geojson');
  const gj = { type:'FeatureCollection', features };
  fs.writeFileSync(file, JSON.stringify(gj));
  return file;
}

async function main(){
  const argv = process.argv.slice(2);
  const limitArg = argv.find(a=>a.startsWith('--limit='));
  const minPopArg = argv.find(a=>a.startsWith('--min-pop='));
  const refresh = argv.includes('--refresh-ne');
  const limit = limitArg ? Math.max(1, Number(limitArg.split('=')[1])||20) : 20;
  const minPop = minPopArg ? Math.max(0, Number(minPopArg.split('=')[1])||0) : 0;
  const targets = argv.filter(a=>/^[A-Z]{3}$/.test(a));
  const list = targets.length ? targets : getISO3List();

  await ensureNE(refresh);
  const ne = readJson(NE_CACHE);

  console.log(`Writing simple city layers for ${list.length} countries (limit=${limit}, minPop=${minPop})`);
  for(const code of list){
    try{
      const subset = filterNEByISO3(ne, code)
        .map(toCityFeature)
        .filter(Boolean)
        .filter(f => (Number(f.properties.population)||0) >= minPop)
        .sort((a,b)=> (Number(b.properties.population)||0) - (Number(a.properties.population)||0))
        .slice(0, limit);
      const file = writeCities(code, subset);
      console.log(`  ${code}: wrote ${subset.length} to ${file}`);
    }catch(e){
      console.error(`  ${code}: failed:`, e && e.message || e);
    }
  }
  console.log('Done');
}

main().catch(e=>{ console.error('FATAL', e && e.message || e); process.exit(1); });
