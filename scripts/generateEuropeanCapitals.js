#!/usr/bin/env node
/*
  Generate a GeoScore question for European capitals using Natural Earth.

  - Downloads/caches:
    - ne_10m_admin_0_countries.geojson
    - ne_10m_admin_0_capitals.geojson

  - Builds question: "Name a European capital city"
    Answers: list of European capitals (cleaned names), uniform scores.

  Usage:
    node scripts/generateEuropeanCapitals.js [--merge-json] [--score=1]

  Notes:
    - Writes/merges into geoscore_questions.json
    - If serviceAccountKey.json exists, also writes to Firestore doc id "EURO_CAPITALS"
*/

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'geoscore_questions.json');
const NE_COUNTRIES_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson';
const NE_CAPITALS_URL  = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_capitals.geojson';
const NE_COUNTRIES_CACHE = path.join(__dirname, 'ne_10m_admin_0_countries.geojson');
const NE_CAPITALS_CACHE  = path.join(__dirname, 'ne_10m_admin_0_capitals.geojson');

function readJson(p){ return JSON.parse(fs.readFileSync(p, 'utf8')); }

async function ensureFile(url, cachePath){
  if(fs.existsSync(cachePath)) return;
  const res = await fetch(url);
  if(!res.ok){ const t = await res.text().catch(()=>res.statusText); throw new Error(`Fetch failed ${res.status}: ${t}`); }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(cachePath, buf);
}

function iso3FromProps(p){
  const cands = [p.ISO_A3, p.ADM0_A3, p.SOV_A3, p.ADM0_A3_US, p.ADM0_A3_UN];
  for(const v of cands){ if(typeof v==='string' && /^[A-Z]{3}$/i.test(v)) return v.toUpperCase(); }
  return '';
}

function cleanName(name){
  let n = String(name||'').trim();
  if(!n) return n;
  const suffixes = ['city municipality','town municipality','municipality','borough','commune','city','town','village'];
  let changed=true; while(changed){ changed=false; for(const suf of suffixes){ const re=new RegExp('\\s+'+suf.replace(/\s+/g,'\\s+')+'\\.?$','i'); if(re.test(n)){ n=n.replace(re,'').trim(); changed=true; break; } } }
  return n;
}

function mergeByQuestion(existing, q){
  const arr = Array.isArray(existing)?existing:[];
  const idx = arr.findIndex(x => x && x.question === q.question);
  if(idx>=0){ arr[idx] = q; return arr; }
  return arr.concat([q]);
}

async function main(){
  const argv = process.argv.slice(2);
  const mergeJson = argv.includes('--merge-json');
  const scoreArg = argv.find(a=>a.startsWith('--score='));
  const scoreVal = scoreArg ? Math.max(1, Number(scoreArg.split('=')[1])||1) : 1;

  await ensureFile(NE_COUNTRIES_URL, NE_COUNTRIES_CACHE);
  await ensureFile(NE_CAPITALS_URL,  NE_CAPITALS_CACHE);
  const neCountries = readJson(NE_COUNTRIES_CACHE);
  const neCaps = readJson(NE_CAPITALS_CACHE);

  const continentByISO3 = new Map();
  for(const f of (neCountries.features||[])){
    const p = f && f.properties || {};
    const code = iso3FromProps(p);
    const cont = (p.CONTINENT || p.REGION_UN || '').toString();
    if(code) continentByISO3.set(code, cont);
  }

  const capitals = [];
  for(const f of (neCaps.features||[])){
    const p = f && f.properties || {};
    const code = iso3FromProps(p);
    const cont = continentByISO3.get(code) || '';
    if(String(cont).toLowerCase() !== 'europe') continue;
    const name = p.NAME || p.NAME_EN || p.name || '';
    if(!name) continue;
    capitals.push(cleanName(name));
  }
  // Deduplicate and sort
  const uniq = Array.from(new Set(capitals)).sort((a,b)=>a.localeCompare(b));
  const answers = uniq.map(n=> ({ answer: n, score: scoreVal, count: scoreVal }));
  const question = { question: 'Name a European capital city', answers };

  // Optional Firestore write (only with --firestore)
  const svc = path.join(ROOT, 'serviceAccountKey.json');
  try{
    if(process.argv.includes('--firestore') && fs.existsSync(svc)){
      const sa = require(svc);
      const projectId = sa.project_id || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
      admin.initializeApp({ credential: admin.credential.cert(sa), projectId });
      const db = admin.firestore();
      await db.collection('geoscoreQuestions').doc('EURO_CAPITALS').set(question).catch(()=>{});
      console.log('Wrote Firestore doc geoscoreQuestions/EURO_CAPITALS');
    }
  }catch(e){ console.warn('Firestore skipped:', e && e.message || e); }

  // Merge/write JSON
  let outArr = [question];
  if(mergeJson && fs.existsSync(OUT_FILE)){
    try{ const existing = readJson(OUT_FILE); outArr = mergeByQuestion(existing, question); }catch{}
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify(outArr, null, 2));
  console.log(`Wrote ${outArr.length} questions to ${OUT_FILE} (European capitals: ${answers.length})`);
}

main().catch(e=>{ console.error('ERROR:', e && e.message || e); process.exit(1); });
