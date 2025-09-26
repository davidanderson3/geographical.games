#!/usr/bin/env node
/**
 * Generate a global list of world cities (names only) with population >= 5,000
 * using Natural Earth 10m populated places (cached in repo under scripts/).
 *
 * Output: world_cities_5k.json (array of strings)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NE_CACHE = path.join(__dirname, 'ne_10m_populated_places_simple.geojson');
const OUT_FILE = path.join(ROOT, 'world_cities_5k.json');
const MIN_POP = 5000;

function readJson(p){ return JSON.parse(fs.readFileSync(p, 'utf8')); }

function main(){
  if(!fs.existsSync(NE_CACHE)){
    console.error('Missing NE cache:', path.relative(ROOT, NE_CACHE));
    process.exit(1);
  }
  const ne = readJson(NE_CACHE);
  const feats = Array.isArray(ne.features) ? ne.features : [];
  const names = new Set();
  for(const f of feats){
    const p = f.properties || {};
    const pop = Number(p.POP_MAX ?? p.pop_max ?? p.POP_MIN ?? p.pop_min) || 0;
    if(pop < MIN_POP) continue;
    const name = p.NAME || p.name || p.NAMEASCII || p.nameascii || '';
    const city = String(name || '').trim();
    if(!city) continue;
    names.add(city);
  }
  const list = Array.from(names).sort((a,b)=> a.localeCompare(b));
  fs.writeFileSync(OUT_FILE, JSON.stringify(list, null, 2));
  console.log(`Wrote ${list.length} cities to ${path.relative(ROOT, OUT_FILE)}`);
}

main();

