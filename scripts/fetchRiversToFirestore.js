#!/usr/bin/env node
/*
  Fetch high‑detail river layers from Overpass (OpenStreetMap)
  and store them in Firestore (chunked), plus write a local high‑res GeoJSON.

  Prereqs:
  - Node 18+ (global fetch available)
  - serviceAccountKey.json in ./scripts (Firebase Admin creds)
  - npm i firebase-admin

  Usage:
    node scripts/fetchRiversToFirestore.js [ISO3 ...]
  If no ISO3 args are given, it processes all countries in geolayers-game/public/countries.json
*/

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'serviceAccountKey.json');
if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error(`Missing service account key at ${SERVICE_ACCOUNT_PATH}`);
  process.exit(1);
}
const serviceAccount = require(SERVICE_ACCOUNT_PATH);

try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });
} catch (e) {
  console.error('Failed to init Firebase Admin SDK:', e && e.message);
  process.exit(1);
}
const db = admin.firestore();

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'geolayers-game', 'public', 'data');
const COUNTRIES_FILE = path.join(ROOT, 'geolayers-game', 'public', 'countries.json');

function readJson(p){ return JSON.parse(fs.readFileSync(p, 'utf8')); }

function getCountryList(){
  const arr = readJson(COUNTRIES_FILE);
  return arr.map(r=>r.code);
}

function getCountryOutline(iso3){
  const outlinePath = path.join(DATA_DIR, iso3, 'outline.geojson');
  if(!fs.existsSync(outlinePath)) throw new Error(`Missing outline for ${iso3}: ${outlinePath}`);
  return readJson(outlinePath);
}

function geojsonBbox(gj){
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  function addCoord(x,y){ if(x<minX)minX=x; if(y<minY)minY=y; if(x>maxX)maxX=x; if(y>maxY)maxY=y; }
  function walkCoords(c){
    if(!c) return;
    if(typeof c[0]==='number' && typeof c[1]==='number'){ addCoord(c[0], c[1]); return; }
    for(const e of c){ walkCoords(e); }
  }
  if(gj.type==='FeatureCollection'){ for(const f of gj.features||[]){ if(f&&f.geometry) walkCoords(f.geometry.coordinates); } }
  else if(gj.type==='Feature' && gj.geometry) walkCoords(gj.geometry.coordinates);
  else if(gj.type) walkCoords(gj.coordinates);
  if(!isFinite(minX)||!isFinite(minY)||!isFinite(maxX)||!isFinite(maxY)) throw new Error('Failed to compute bbox');
  return [minY, minX, maxY, maxX]; // south, west, north, east
}

async function fetchOverpass(bbox){
  const [s,w,n,e] = bbox;
  const endpoint = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
  const q = `
  [out:json][timeout:180];
  (
    way["waterway"~"^(river|stream|canal|drain)$"](${s},${w},${n},${e});
    relation["waterway"~"^(river|stream|canal|drain)$"](${s},${w},${n},${e});
  );
  out body geom;
  `;
  const res = await fetch(endpoint, { method:'POST', body: q, headers:{ 'Content-Type':'text/plain' } });
  if(!res.ok){ const t=await res.text().catch(()=>res.statusText); throw new Error(`Overpass HTTP ${res.status}: ${t}`); }
  return res.json();
}

function simplifyProps(tags){
  tags = tags || {};
  return { name: tags.name || tags['name:en'] || null, waterway: tags.waterway || null };
}

function osmToGeoJSON(osm){
  const out = { type:'FeatureCollection', features: [] };
  const elements = Array.isArray(osm && osm.elements) ? osm.elements : [];
  for(const el of elements){
    if(!el) continue;
    if(el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2){
      const coords = el.geometry.map(p=> [Number(p.lon), Number(p.lat)]).filter(a=> Number.isFinite(a[0]) && Number.isFinite(a[1]));
      if(coords.length >= 2){
        out.features.push({ type:'Feature', properties: simplifyProps(el.tags), geometry: { type:'LineString', coordinates: coords } });
      }
    } else if(el.type === 'relation' && Array.isArray(el.members)){
      const lines = [];
      for(const m of el.members){
        if(Array.isArray(m.geometry) && m.geometry.length >= 2){
          const c = m.geometry.map(p=> [Number(p.lon), Number(p.lat)]).filter(a=> Number.isFinite(a[0]) && Number.isFinite(a[1]));
          if(c.length >= 2) lines.push(c);
        }
      }
      if(lines.length === 1){
        out.features.push({ type:'Feature', properties: simplifyProps(el.tags), geometry: { type:'LineString', coordinates: lines[0] } });
      } else if(lines.length > 1){
        out.features.push({ type:'Feature', properties: simplifyProps(el.tags), geometry: { type:'MultiLineString', coordinates: lines } });
      }
    }
  }
  return out;
}

function estimateSize(obj){ return Buffer.byteLength(JSON.stringify(obj)); }

function chunkFeatures(features, maxBytes=900_000){
  const chunks = [];
  let cur = [];
  let curSize = 2; // []
  for(const f of features){
    const s = estimateSize(f);
    if(cur.length && (curSize + s + 1) > maxBytes){ // ,
      chunks.push(cur);
      cur = [];
      curSize = 2;
    }
    cur.push(f);
    curSize += s + 1;
  }
  if(cur.length) chunks.push(cur);
  return chunks;
}

async function storeInFirestore(iso3, features){
  const root = db.collection('riverLayers').doc(iso3);
  await root.set({ updatedAt: admin.firestore.FieldValue.serverTimestamp(), featureCount: features.length }, { merge:true });
  const chunks = chunkFeatures(features);
  const batch = db.batch();
  const chunksColl = root.collection('chunks');
  // Clear previous chunks: delete in batches
  const prev = await chunksColl.listDocuments();
  for(const d of prev){ batch.delete(d); }
  for(let i=0;i<chunks.length;i++){
    const id = `chunk_${String(i+1).padStart(4,'0')}`;
    const doc = chunksColl.doc(id);
    batch.set(doc, { index: i, count: chunks[i].length, features: chunks[i] });
  }
  await batch.commit();
  return { chunks: chunks.length };
}

async function writeLocal(iso3, features){
  const dir = path.join(DATA_DIR, iso3);
  fs.mkdirSync(dir, { recursive:true });
  const file = path.join(dir, 'rivers_highres.geojson');
  const gj = { type:'FeatureCollection', features };
  fs.writeFileSync(file, JSON.stringify(gj));
  return file;
}

async function main(){
  const all = getCountryList();
  const targets = process.argv.slice(2).filter(Boolean).length ? process.argv.slice(2) : all;
  console.log(`Fetching high‑res rivers for ${targets.length} countries...`);
  for(const iso3 of targets){
    try{
      const outline = getCountryOutline(iso3);
      const bbox = geojsonBbox(outline);
      console.log(`→ ${iso3} bbox:`, bbox.map(n=>+n.toFixed(4)).join(','));
      const osm = await fetchOverpass(bbox);
      const gj = osmToGeoJSON(osm);
      let feats = (gj && gj.features) ? gj.features : [];
      // Drop junk
      feats = feats.filter(f=>f && f.geometry && f.geometry.type && Array.isArray(f.geometry.coordinates));
      console.log(`   ${iso3}: ${feats.length} features`);
      const file = await writeLocal(iso3, feats);
      console.log(`   wrote ${file}`);
      const meta = await storeInFirestore(iso3, feats);
      console.log(`   stored in Firestore (${meta.chunks} chunks)`);
      // be kind to Overpass
      await new Promise(r=>setTimeout(r, 1000));
    }catch(err){
      console.error(`× ${iso3} failed:`, err && err.message || err);
    }
  }
  console.log('Done');
}

main().catch(e=>{ console.error('FATAL', e && e.message || e); process.exit(1); });
