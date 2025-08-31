#!/usr/bin/env node
/*
  Generate geolayers-game/public/countries.json with all countries from
  Natural Earth admin_0 dataset (ISO_A3 code + ADMIN name).

  Usage:
    node scripts/generateCountriesJsonFromNE.js

  Notes:
    - Downloads the NE file to scripts/ne_10m_admin_0_countries.geojson if missing
    - Skips entries with invalid ISO_A3 (e.g., -99)
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'geolayers-game', 'public', 'countries.json');
const NE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson';
const NE_CACHE = path.join(__dirname, 'ne_10m_admin_0_countries.geojson');

async function ensureNE(){
  if (fs.existsSync(NE_CACHE)) return;
  const res = await fetch(NE_URL);
  if(!res.ok){ const t = await res.text().catch(()=>res.statusText); throw new Error(`NE download failed: ${res.status} ${t}`); }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(NE_CACHE, buf);
}

function readJson(p){ return JSON.parse(fs.readFileSync(p, 'utf8')); }

async function main(){
  await ensureNE();
  const ne = readJson(NE_CACHE);
  const feats = Array.isArray(ne && ne.features) ? ne.features : [];
  const map = new Map();
  for(const f of feats){
    const p = f && f.properties ? f.properties : {};
    const code = String(p.ISO_A3 || p.ADM0_A3 || p.SOV_A3 || '').toUpperCase();
    if(!code || code === '-99' || !/^[A-Z]{3}$/.test(code)) continue;
    const name = String(p.ADMIN || p.NAME || p.NAME_EN || '').trim() || code;
    if(!map.has(code)) map.set(code, name);
  }
  const list = Array.from(map.entries()).map(([code,name])=>({ code, name })).sort((a,b)=>a.name.localeCompare(b.name));
  // Ensure output dir exists
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive:true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(list, null, 2));
  console.log(`Wrote ${list.length} countries to ${OUT_FILE}`);
}

main().catch(e=>{ console.error('ERROR:', e && e.message || e); process.exit(1); });

