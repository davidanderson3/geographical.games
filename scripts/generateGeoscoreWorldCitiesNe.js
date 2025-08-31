#!/usr/bin/env node
/*
  Generate GeoScore questions for ALL countries directly from Natural Earth
  populated places (no dependency on geolayers city files).

  - For each country in geolayers-game/public/countries.json
  - Pull NE 10m populated places, filter by ISO3 and min population
  - Build: "Name a city in <Country>" with population-weighted scores

  Usage:
    node scripts/generateGeoscoreWorldCitiesNe.js --merge-json [--min-pop=10000]
    node scripts/generateGeoscoreWorldCitiesNe.js USA MEX --merge-json --min-pop=50000

  Flags:
    --merge-json       Merge into existing geoscore_questions.json instead of overwriting
    --min-pop=N        Minimum population (default 10000)
    --force            Include countries even if result is empty (otherwise skipped)
*/

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'geoscore_questions.json');
const COUNTRIES_FILE = path.join(ROOT, 'geolayers-game', 'public', 'countries.json');

const NE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson';
const NE_CACHE = path.join(__dirname, 'ne_10m_populated_places_simple.geojson');

const SERVICE_ACCOUNT_PATH = path.join(ROOT, 'serviceAccountKey.json');
const TOT_MENTIONS = 100; // interpret as ~expected guesses out of 100 attempts

function readJson(p){ return JSON.parse(fs.readFileSync(p, 'utf8')); }

async function ensureNE(refresh){
  if (!refresh && fs.existsSync(NE_CACHE)) return;
  const r = await fetch(NE_URL);
  if(!r.ok){ const t = await r.text().catch(()=>String(r.status)); throw new Error(`NE download failed: ${r.status} ${t}`); }
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(NE_CACHE, buf);
}

function getCountries(){
  try{ const arr = readJson(COUNTRIES_FILE); return arr.map(r=>({ code:r.code, name:r.name })); }catch{ return []; }
}

function filterNEByISO3(ne, code){
  const rows = Array.isArray(ne?.features) ? ne.features : [];
  const ISO3 = String(code||'').toUpperCase();
  return rows.filter(f => {
    const p = f && f.properties ? f.properties : null;
    if(!p) return false;
    const cands = [p.ADM0_A3,p.adm0_a3,p.ISO_A3,p.iso_a3,p.SOV_A3,p.sov_a3,p.ADM0_A3_US,p.adm0_a3_us,p.ADM0_A3_UN,p.adm0_a3_un];
    return cands.some(v => typeof v === 'string' && v.toUpperCase() === ISO3);
  });
}

function toCity(f){
  const g = f && f.geometry;
  if(!g || g.type !== 'Point' || !Array.isArray(g.coordinates)) return null;
  const p = f.properties || {};
  const pop = Number(p.POP_MAX ?? p.pop_max ?? p.POP_MIN ?? p.pop_min) || 0;
  const name = p.NAME || p.name || p.NAMEASCII || p.nameascii || '';
  const admin1 = p.ADM1NAME || p.adm1name || p.REGION || p.region || null;
  return name ? { name, population: pop, admin1 } : null;
}

function cleanName(name){
  let n = String(name||'').trim();
  if(!n) return n;
  const suffixes = ['city municipality','town municipality','unified government','metropolitan government','city-county','census designated place','cdp','municipality','borough','commune','county','parish','city','town','village'];
  let changed=true; while(changed){ changed=false; for(const suf of suffixes){ const re=new RegExp('\\s+'+suf.replace(/\s+/g,'\\s+')+'\\.?$','i'); if(re.test(n)){ n=n.replace(re,'').trim(); changed=true; break; } } }
  return n;
}

function allocScoresRecall(cities){
  if(!cities.length) return [];
  // Rank within country
  const sorted = cities.slice().sort((a,b)=> (Number(b.population)||0) - (Number(a.population)||0));
  const rankMap = new Map(); sorted.forEach((c,i)=> rankMap.set(c.name, i+1));
  const sigmoid = (z)=> 1/(1+Math.exp(-z));
  const nameEase = (n)=>{
    const s=String(n||'');
    const letters = s.replace(/[^\p{L}]/gu,'');
    const ascii = letters.replace(/[^A-Za-z]/g,'');
    const asciiRatio = letters.length? (ascii.length/letters.length) : 1;
    const len = letters.length || s.length;
    let ease = 0.5 + 0.5*asciiRatio; // 0.5..1.0 baseline
    if(len<=7) ease += 0.2; else if(len<=11) ease += 0.1;
    return Math.min(1.2, ease);
  };
  // Calibrated coefficients: interpret as expected recalls per 100 guesses
  const A = 1.0, B = 2.5, C = 0.5, D = -8.0; // z = A*log10(pop) + B*(1/sqrt(rank)) + C*nameEase + D
  return cities.map(c => {
    const pop = Math.max(1, Number(c.population)||1);
    const rr = 1/Math.sqrt(Math.max(1, rankMap.get(c.name)||1));
    const z = A*Math.log10(pop) + B*rr + C*nameEase(c.name) + D;
    const p = Math.max(0, Math.min(100, Math.round(100*sigmoid(z))));
    return { answer: cleanName(c.name), score: p, count: p };
  });
}

function mergeInto(existing, newQs){
  const map = new Map();
  for(const q of Array.isArray(existing)?existing:[]) map.set(q.question, q);
  for(const q of newQs) map.set(q.question, q);
  return Array.from(map.values());
}

async function main(){
  const argv = process.argv.slice(2);
  const minPopArg = argv.find(a=>a.startsWith('--min-pop='));
  const mergeJson = argv.includes('--merge-json');
  const force = argv.includes('--force');
  const minPop = minPopArg ? Math.max(0, Number(minPopArg.split('=')[1])||10000) : 10000;
  const targets = argv.filter(a=>/^[A-Z]{3}$/.test(a.toUpperCase())).map(s=>s.toUpperCase());

  await ensureNE(false);
  const ne = readJson(NE_CACHE);
  const countries = getCountries();
  const list = targets.length ? countries.filter(c=>targets.includes(c.code)) : countries;
  if(!list.length){ console.error('No countries to process.'); process.exit(1); }

  // Optional Firestore (only with --firestore)
  let db = null; let coll = null; let batch = null;
  if(process.argv.includes('--firestore') && fs.existsSync(SERVICE_ACCOUNT_PATH)){
    try{ const sa=require(SERVICE_ACCOUNT_PATH); const projectId=sa.project_id||process.env.GCLOUD_PROJECT||process.env.GOOGLE_CLOUD_PROJECT; admin.initializeApp({credential:admin.credential.cert(sa), projectId}); db=admin.firestore(); coll=db.collection('geoscoreQuestions'); batch=db.batch(); }catch{}
  }

  const out = [];
  for(const c of list){
    const rows = filterNEByISO3(ne, c.code).map(toCity).filter(Boolean).filter(x => (Number(x.population)||0) >= minPop).sort((a,b)=> (Number(b.population)||0) - (Number(a.population)||0));
    if(!rows.length){ const msg=`No cities >=${minPop} for ${c.code} (${c.name})`; if(force){ console.warn(msg); } else { continue; } }
    const answers = allocScoresRecall(rows);
    const doc = { question: `Name a city in ${c.name}`, answers };
    out.push(doc);
    if(batch && coll){ batch.set(coll.doc(c.code), doc); }
  }
  if(batch){ try{ await batch.commit(); }catch{} }

  let write = out;
  if(mergeJson && fs.existsSync(OUT_FILE)){
    try{
      const existing = readJson(OUT_FILE);
      // Preserve existing entries (e.g., US state questions) and append new country questions.
      // UI handles country display de-duplication.
      write = (Array.isArray(existing)?existing:[]).concat(out);
    }catch{}
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify(write, null, 2));
  console.log(`Wrote ${write.length} questions to ${path.relative(ROOT, OUT_FILE)}`);
}

main().catch(e=>{ console.error('ERROR:', e && e.message || e); process.exit(1); });
