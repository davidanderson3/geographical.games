#!/usr/bin/env node
/*
  Filter cities.geojson to exclude places below a population threshold.

  - Scans geolayers-game/public/data/<ISO3>/cities.geojson
  - Keeps features with population >= minPop
  - Writes back in place (default) or to a separate file with --suffix

  Usage:
    node scripts/filterCitiesByPopulation.js                 # all ISO3, min 10000
    node scripts/filterCitiesByPopulation.js BRA MEX         # specific ISO3s

  Options:
    --min-pop=N        Population threshold (default 10000)
    --suffix=-10k      Write to cities-10k.geojson (instead of overwriting)
    --dry-run          Show counts; do not write files
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'geolayers-game', 'public', 'data');
const COUNTRIES_FILE = path.join(ROOT, 'geolayers-game', 'public', 'countries.json');

function readJson(p){ return JSON.parse(fs.readFileSync(p, 'utf8')); }
function tryReadJson(p){ try{ return readJson(p); }catch{ return null; } }

function getISO3List(){
  try { return readJson(COUNTRIES_FILE).map(r=>r.code); } catch { return []; }
}

function parsePop(v){
  if(v === null || v === undefined) return 0;
  if(typeof v === 'number' && isFinite(v)) return v;
  const s = String(v).replace(/[,\s]/g,'');
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

function featurePopulation(f){
  const p = (f && f.properties) || {};
  return parsePop(p.population ?? p.POP_MAX ?? p.pop_max ?? p.POP_MIN ?? p.pop_min ?? p.POP_EST ?? p.pop_est ?? 0);
}

function filterFile(iso3, minPop, suffix, dryRun){
  const inPath = path.join(DATA_DIR, iso3, 'cities.geojson');
  if(!fs.existsSync(inPath)) { console.warn(`  ${iso3}: no cities.geojson — skipping`); return; }
  const gj = tryReadJson(inPath);
  if(!gj || gj.type !== 'FeatureCollection') { console.warn(`  ${iso3}: invalid GeoJSON — skipping`); return; }
  const feats = Array.isArray(gj.features) ? gj.features : [];
  const before = feats.length;
  const kept = feats.filter(f => featurePopulation(f) >= minPop);
  const after = kept.length;
  console.log(`  ${iso3}: ${after}/${before} kept (>= ${minPop})`);
  if(dryRun) return;
  const out = { type:'FeatureCollection', features: kept };
  const outPath = suffix ? path.join(DATA_DIR, iso3, `cities${suffix}.geojson`) : inPath;
  fs.writeFileSync(outPath, JSON.stringify(out));
}

async function main(){
  const argv = process.argv.slice(2);
  const minPopArg = argv.find(a=>a.startsWith('--min-pop='));
  const suffixArg = argv.find(a=>a.startsWith('--suffix='));
  const dryRun = argv.includes('--dry-run');
  const minPop = minPopArg ? Math.max(0, Number(minPopArg.split('=')[1])||0) : 10000;
  const suffix = suffixArg ? String(suffixArg.split('=')[1]||'').trim() : '';
  const targets = argv.filter(a=>/^[A-Z]{3}$/.test(a.toUpperCase())).map(s=>s.toUpperCase());
  const list = targets.length ? targets : getISO3List();
  if(!list.length){ console.error('No countries found.'); process.exit(1); }
  console.log(`Filtering cities for ${list.length} countries (min-pop=${minPop}${suffix?`, suffix='${suffix}'`:''}${dryRun?', dry-run':''})`);
  for(const iso3 of list){
    try{ filterFile(iso3, minPop, suffix, dryRun); }catch(e){ console.warn(`  ${iso3}: failed:`, e && e.message || e); }
  }
  console.log('Done.');
}

main().catch(e=>{ console.error('ERROR:', e && e.message || e); process.exit(1); });

