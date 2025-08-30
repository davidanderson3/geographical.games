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

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

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

const ALPHA2_BY_ALPHA3 = {
  ARG:'AR', AUS:'AU', BRA:'BR', CAN:'CA', CHN:'CN', EGY:'EG', FRA:'FR', DEU:'DE',
  IND:'IN', ITA:'IT', JPN:'JP', MEX:'MX', NLD:'NL', NOR:'NO', RUS:'RU', ZAF:'ZA',
  KOR:'KR', ESP:'ES', SWE:'SE', CHE:'CH', TUR:'TR', GBR:'GB', USA:'US'
};

async function fetchOverpass(bbox, includeStreams, includeIntermittent, opts={}, iso3){
  const [s,w,n,e] = bbox;
  const defaultEndpoints = [
    process.env.OVERPASS_URL,
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ].filter(Boolean);
  const water = includeStreams ? '^(river|stream|canal|drain)$' : '^(river|canal)$';
  const intermit = includeIntermittent ? '' : '["intermittent"!~"^(yes|1|true)$"]';
  const alpha2 = iso3 ? (ALPHA2_BY_ALPHA3[iso3] || '') : '';
  const areaBlock = iso3 ? `
  (
    area["ISO3166-1:alpha3"="${iso3}"];
    ${alpha2 ? `area["ISO3166-1"="${alpha2}"];` : ''}
  )->.a;
  ` : '';
  const q = `
  [out:json][timeout:${opts.timeoutSec||180}];
  ${areaBlock}
  (
    way["waterway"~"${water}"]${intermit}${iso3 ? '(area.a)' : ''}(${s},${w},${n},${e});
    relation["waterway"~"${water}"]${intermit}${iso3 ? '(area.a)' : ''}(${s},${w},${n},${e});
  );
  out body geom;
  `;
  const attempts = opts.attempts || 5;
  let delay = opts.retryDelayMs || 2000;
  const endpoints = (opts.endpoints || defaultEndpoints);
  for(let i=0;i<attempts;i++){
    const endpoint = endpoints[i % endpoints.length];
    try{
      const res = await fetch(endpoint, { method:'POST', body: q, headers:{ 'Content-Type':'text/plain' } });
      if(!res.ok){
        const t=await res.text().catch(()=>res.statusText);
        if(res.status===429 || /rate_limited/i.test(t||'')) throw new Error(`429 Rate limited: ${t}`);
        throw new Error(`Overpass HTTP ${res.status}: ${t}`);
      }
      return await res.json();
    }catch(err){
      if(i === attempts-1) throw err;
      await sleep(delay);
      delay = Math.min(delay*1.8, 15000);
    }
  }
}

function simplifyProps(tags){
  tags = tags || {};
  return { name: tags.name || tags['name:en'] || null, waterway: tags.waterway || null };
}

function osmToGeoJSON(osm, seen){
  const out = { type:'FeatureCollection', features: [] };
  const elements = Array.isArray(osm && osm.elements) ? osm.elements : [];
  for(const el of elements){
    if(!el) continue;
    const key = (el.type === 'way' ? 'w' : el.type === 'relation' ? 'r' : null);
    if(!key) continue;
    const idKey = `${key}${el.id}`;
    if(seen && seen.has(idKey)) continue;
    if(el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2){
      const coords = el.geometry.map(p=> [Number(p.lon), Number(p.lat)]).filter(a=> Number.isFinite(a[0]) && Number.isFinite(a[1]));
      if(coords.length >= 2){
        out.features.push({ type:'Feature', properties: simplifyProps(el.tags), geometry: { type:'LineString', coordinates: coords } });
        if(seen) seen.add(idKey);
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
        if(seen) seen.add(idKey);
      } else if(lines.length > 1){
        out.features.push({ type:'Feature', properties: simplifyProps(el.tags), geometry: { type:'MultiLineString', coordinates: lines } });
        if(seen) seen.add(idKey);
      }
    }
  }
  return out;
}

function splitBbox([s,w,n,e], maxDeg){
  const latSpan = Math.max(0.0001, n - s);
  const lonSpan = Math.max(0.0001, e - w);
  const rows = Math.ceil(latSpan / maxDeg);
  const cols = Math.ceil(lonSpan / maxDeg);
  const out = [];
  for(let r=0;r<rows;r++){
    for(let c=0;c<cols;c++){
      const bs = s + r * latSpan / rows;
      const bn = s + (r+1) * latSpan / rows;
      const bw = w + c * lonSpan / cols;
      const be = w + (c+1) * lonSpan / cols;
      out.push([+bs.toFixed(6), +bw.toFixed(6), +bn.toFixed(6), +be.toFixed(6)]);
    }
  }
  return out;
}

function createGeoJSONStreamWriter(file){
  const ws = fs.createWriteStream(file, { encoding:'utf8' });
  let first = true;
  ws.write('{"type":"FeatureCollection","features":[');
  return {
    append(features){
      for(const f of features){
        const s = JSON.stringify(f);
        if(first){ ws.write(s); first=false; }
        else { ws.write(','+s); }
      }
    },
    end(){ ws.write(']}'); ws.end(); }
  };
}

// Haversine distance between two lon/lat points in km
function distKm(a, b){
  const toRad = d => d * Math.PI / 180;
  const R = 6371; // km
  const dlat = toRad(b[1] - a[1]);
  const dlon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const sinDLat = Math.sin(dlat/2), sinDLon = Math.sin(dlon/2);
  const h = sinDLat*sinDLat + Math.cos(lat1)*Math.cos(lat2)*sinDLon*sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
  return R * c;
}

function lineLengthKm(geom){
  if(!geom || !geom.type) return 0;
  if(geom.type === 'LineString'){
    const c = geom.coordinates || [];
    let s = 0; for(let i=1;i<c.length;i++) s += distKm(c[i-1], c[i]);
    return s;
  }
  if(geom.type === 'MultiLineString'){
    let sum = 0; for(const ls of (geom.coordinates||[])){ if(Array.isArray(ls)){ for(let i=1;i<ls.length;i++) sum += distKm(ls[i-1], ls[i]); } }
    return sum;
  }
  return 0;
}

// ------------------------
// In-outline clipping utils
// ------------------------
function pointInRing(pt, ring){
  // ray-casting; pt: [lon,lat]
  let inside = false;
  const n = ring.length;
  for(let i=0, j=n-1; i<n; j=i++){
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi>pt[1]) !== (yj>pt[1])) &&
      (pt[0] < (xj - xi) * (pt[1] - yi) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function pointInPolygon(pt, poly){
  if(!Array.isArray(poly) || !poly.length) return false;
  if(!pointInRing(pt, poly[0])) return false; // outside outer ring
  for(let k=1;k<poly.length;k++) if(pointInRing(pt, poly[k])) return false; // in a hole
  return true;
}
function pointInMultiPolygon(pt, mp){
  const polys = Array.isArray(mp) ? mp : [];
  for(const poly of polys){ if(pointInPolygon(pt, poly)) return true; }
  return false;
}
function clipLineStringToMultiPolygon(coords, mp){
  const segs = [];
  let cur = [];
  for(const c of (coords||[])){
    if(pointInMultiPolygon(c, mp)) cur.push(c); else { if(cur.length>=2) segs.push(cur); cur=[]; }
  }
  if(cur.length>=2) segs.push(cur);
  if(!segs.length) return null;
  if(segs.length===1) return { type:'LineString', coordinates: segs[0] };
  return { type:'MultiLineString', coordinates: segs };
}
function clipGeometryToOutline(geom, outlineFeature){
  if(!geom || !outlineFeature || !outlineFeature.geometry) return geom;
  const g = outlineFeature.geometry;
  const mp = g.type==='MultiPolygon' ? g.coordinates : (g.type==='Polygon' ? [g.coordinates] : null);
  if(!mp) return geom;
  if(geom.type==='LineString') return clipLineStringToMultiPolygon(geom.coordinates||[], mp);
  if(geom.type==='MultiLineString'){
    const out = [];
    for(const ls of (geom.coordinates||[])){
      const clipped = clipLineStringToMultiPolygon(ls||[], mp);
      if(!clipped) continue;
      if(clipped.type==='LineString') out.push(clipped.coordinates);
      else if(clipped.type==='MultiLineString') out.push(...clipped.coordinates);
    }
    if(!out.length) return null;
    if(out.length===1) return { type:'LineString', coordinates: out[0] };
    return { type:'MultiLineString', coordinates: out };
  }
  return geom;
}

function estimateSize(obj){ return Buffer.byteLength(JSON.stringify(obj)); }

function chunkFeatures(features, maxBytes=250_000){
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

async function storeInFirestore(iso3, features, opts={}){
  if(opts.noFirestore) return { chunks: 0 };
  const root = db.collection('riverLayers').doc(iso3);
  await root.set({ updatedAt: admin.firestore.FieldValue.serverTimestamp(), featureCount: features.length }, { merge:true });
  const chunks = chunkFeatures(features);
  const chunksColl = root.collection('chunks');
  // Delete previous chunks
  const prev = await chunksColl.listDocuments();
  for(let i=0;i<prev.length;i+=400){
    const batch = db.batch();
    prev.slice(i,i+400).forEach(d => batch.delete(d));
    await batch.commit();
    if(opts.throttleMs) await sleep(opts.throttleMs);
  }
  // Write in waves
  let written = 0;
  for(let i=0;i<chunks.length;i+=400){
    const batch = db.batch();
    const part = chunks.slice(i,i+400);
    part.forEach((arr, idx) => {
      const index = i + idx;
      const id = `chunk_${String(index+1).padStart(4,'0')}`;
      batch.set(chunksColl.doc(id), { index, count: arr.length, features: arr });
    });
    let tries=0, backoff=opts.backoffMs||1000;
    for(;;){
      try { await batch.commit(); break; }
      catch(e){
        const msg = (e && e.message) || '';
        if(/RESOURCE_EXHAUSTED|Quota exceeded|deadline exceeded/i.test(msg) && tries < (opts.maxCommitRetries||5)){
          await sleep(backoff);
          backoff = Math.min(backoff*2, 20000);
          tries++;
          continue;
        }
        throw e;
      }
    }
    written += part.length;
    if(opts.throttleMs) await sleep(opts.throttleMs);
  }
  return { chunks: chunks.length };
}

async function writeLocalStreamed(iso3, features){
  const dir = path.join(DATA_DIR, iso3);
  fs.mkdirSync(dir, { recursive:true });
  const file = path.join(dir, 'rivers_highres.geojson');
  const writer = createGeoJSONStreamWriter(file);
  writer.append(features);
  writer.end();
  return file;
}

async function main(){
  const all = getCountryList();
  const argv = process.argv.slice(2);
  const includeStreams = argv.includes('--streams');
  const includeIntermittent = argv.includes('--include-intermittent');
  // Default: do NOT write to Firestore unless --firestore is explicitly passed
  const noFirestore = argv.includes('--no-firestore') || !argv.includes('--firestore');
  const tileDegArg = argv.find(a=>a.startsWith('--tile-deg='));
  const tileDeg = tileDegArg ? Math.max(1, Math.min(20, Number(tileDegArg.split('=')[1])||10)) : 10;
  const sleepArg = argv.find(a=>a.startsWith('--sleep='));
  const sleepMs = sleepArg ? Math.max(0, Number(sleepArg.split('=')[1])||1500) : 1500;
  const minKmArg = argv.find(a=>a.startsWith('--min-km='));
  const minKm = minKmArg ? Math.max(0, Number(minKmArg.split('=')[1])||0) : 0;
  const namedOnly = argv.includes('--named-only');
  const clipToOutline = argv.includes('--clip-to-outline');
  const minBytesArg = argv.find(a=>a.startsWith('--min-bytes='));
  const minBytes = minBytesArg ? Math.max(1, Number(minBytesArg.split('=')[1])||1024) : 1024;
  const force = argv.includes('--force');
  const targets = argv.filter(a=>/^[A-Z]{3}$/.test(a));
  const list = targets.length ? targets : all;
  let banner = 'Fetching high‑res rivers for ' + list.length + ' countries... ';
  banner += noFirestore ? '(file output only)' : '(also writing to Firestore)';
  if (includeStreams) banner += ' +streams';
  if (includeIntermittent) banner += ' +intermittent';
  if (minKm) banner += ' min ' + minKm + 'km';
  if (namedOnly) banner += ' named-only';
  banner += clipToOutline ? ' clip-to-outline' : '';
  banner += force ? ' (force overwrite)' : ' (skip existing)';
  console.log(banner);
  for(const iso3 of list){
    try{
      const outline = getCountryOutline(iso3);
      const bbox = geojsonBbox(outline);
      console.log(`→ ${iso3} bbox:`, bbox.map(n=>+n.toFixed(4)).join(','), includeStreams ? '(with streams)' : '(rivers/canals only)');
      const tiles = splitBbox(bbox, includeStreams ? Math.min(6, tileDeg) : tileDeg);
      const seen = new Set();
      const dir = path.join(DATA_DIR, iso3);
      fs.mkdirSync(dir, { recursive:true });
      const file = path.join(dir, 'rivers_highres.geojson');
      if(!force){
        try{
          const st = fs.statSync(file);
          if(st && st.isFile() && st.size >= minBytes){
            console.log(`   ${iso3}: exists (${st.size} bytes) — skipping. Use --force to overwrite or --min-bytes to adjust threshold.`);
            continue;
          }
        }catch{}
      }
      const writer = createGeoJSONStreamWriter(file);
      const allFeatures = [];
      for(let t=0;t<tiles.length;t++){
        const bb = tiles[t];
        try{
          const osm = await fetchOverpass(bb, includeStreams, includeIntermittent, { attempts: 6, retryDelayMs: 2500 }, iso3);
          const gj = osmToGeoJSON(osm, seen);
          let feats = (gj && gj.features) ? gj.features : [];
          if (clipToOutline) {
            const clipped = [];
            const outlineGeom = outline && outline.features ? outline.features[0] : outline;
            for (const f of feats) {
              const cg = clipGeometryToOutline(f.geometry, outlineGeom);
              if (cg) clipped.push({ type:'Feature', properties:f.properties||{}, geometry: cg });
            }
            feats = clipped;
          }
          if(namedOnly) feats = feats.filter(f => f && f.properties && f.properties.name);
          if(minKm>0) feats = feats.filter(f => lineLengthKm(f.geometry) >= minKm);
          writer.append(feats);
          for (const f of feats) allFeatures.push(f);
          console.log(`   tile ${t+1}/${tiles.length}: +${feats.length} features`);
        }catch(tileErr){
          console.warn(`   tile ${t+1}/${tiles.length} failed:`, tileErr && tileErr.message || tileErr);
        }
        await sleep(sleepMs);
      }
      writer.end();
      console.log(`   wrote ${file}`);
      const meta = await storeInFirestore(iso3, allFeatures, { noFirestore, throttleMs: 500, maxCommitRetries: 6 });
      console.log(`   stored in Firestore (${meta.chunks} chunks)`);
      // be kind to Overpass
      await sleep(1000);
    }catch(err){
      console.error(`× ${iso3} failed:`, err && err.message || err);
    }
  }
  console.log('Done');
}

main().catch(e=>{ console.error('FATAL', e && e.message || e); process.exit(1); });
