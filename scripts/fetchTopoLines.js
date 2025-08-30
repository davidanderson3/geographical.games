#!/usr/bin/env node
/*
  Fetch a light "topo lines" layer per country from OpenStreetMap (Overpass)
  and write to geolayers-game/public/data/<ISO3>/roads.geojson.

  Focus: only major highways by default (motorway, trunk, primary). Optional
  flags allow adding secondary and railways. Includes rate-limit handling,
  tiling, and optional line simplification to keep files small.

  Flags:
    --include-secondary    Include highway=secondary
    --include-rail         Include railway=rail
    --tile-deg=N           Tile size in degrees (default 10)
    --sleep=MS             Delay between tiles (default 1500)
    --simplify-km=K        RDP simplify tolerance in kilometers (e.g., 0.5)

  Usage:
    node scripts/fetchTopoLines.js                 # all ISO3 in countries.json
    node scripts/fetchTopoLines.js USA MEX         # specific ISO3
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'geolayers-game', 'public', 'data');
const COUNTRIES_FILE = path.join(ROOT, 'geolayers-game', 'public', 'countries.json');

function readJson(p){ return JSON.parse(fs.readFileSync(p, 'utf8')); }
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

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

async function fetchOverpass(bbox, includeSecondary, includeRail, opts={}, iso3){
  const [s,w,n,e] = bbox;
  const defaultEndpoints = [
    process.env.OVERPASS_URL,
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ].filter(Boolean);
  const hwBase = '^(motorway|trunk|primary' + (includeSecondary?'|secondary':'') + ')$';
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
    way["highway"~"${hwBase}"]${iso3?'(area.a)':''}(${s},${w},${n},${e});
    relation["highway"~"${hwBase}"]${iso3?'(area.a)':''}(${s},${w},${n},${e});
    ${includeRail ? `way["railway"~"^(rail)$"]${iso3?'(area.a)':''}(${s},${w},${n},${e}); relation["railway"~"^(rail)$"]${iso3?'(area.a)':''}(${s},${w},${n},${e});` : ''}
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
  const name = tags.name || tags['name:en'] || null;
  const highway = tags.highway || null;
  const railway = tags.railway || null;
  return { name, highway, railway };
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

// RDP simplification in degrees; if simplifyKm given, convert using approx factor
function approxDegFromKm(km){ return km / 111.32; }

function rdpLine(coords, epsilon){
  if(!Array.isArray(coords) || coords.length < 3) return coords;
  const sq = x=>x*x;
  const eps2 = epsilon*epsilon;
  const keep = new Array(coords.length).fill(false);
  keep[0] = true;
  keep[coords.length-1] = true;
  const stack = [[0, coords.length-1]];
  function perpDist2(p,a,b){
    const x=a[0], y=a[1], u=b[0]-a[0], v=b[1]-a[1];
    const den = (u*u+v*v) || 1;
    const t = ((p[0]-x)*u + (p[1]-y)*v) / den;
    const tcl = t < 0 ? 0 : (t > 1 ? 1 : t);
    const px = x + tcl*u, py = y + tcl*v;
    return sq(p[0]-px) + sq(p[1]-py);
  }
  while(stack.length){
    const seg = stack.pop();
    const first = seg[0], last = seg[1];
    let index = -1, dmax = 0;
    for(let i=first+1;i<last;i++){
      const d = perpDist2(coords[i], coords[first], coords[last]);
      if(d>dmax){ index=i; dmax=d; }
    }
    if(dmax > eps2 && index > first && index < last){
      keep[index] = true;
      stack.push([first, index]);
      stack.push([index, last]);
    }
  }
  const out = [];
  for(let i=0;i<coords.length;i++) if(keep[i]) out.push(coords[i]);
  if(out.length < 2) return [coords[0], coords[coords.length-1]]; // safety
  return out;
}

function simplifyGeometry(geom, simplifyKm){
  if(!simplifyKm || simplifyKm<=0) return geom;
  try{
    const eps = approxDegFromKm(simplifyKm);
    if(geom.type==='LineString'){
      const coords = Array.isArray(geom.coordinates) ? geom.coordinates : [];
      const simp = coords.length > 10000 ? coords.filter((_,i)=> (i%2===0)) : rdpLine(coords, eps);
      return { type:'LineString', coordinates: simp };
    }
    if(geom.type==='MultiLineString'){
      const out = [];
      for(const ls of (geom.coordinates||[])){
        const coords = Array.isArray(ls) ? ls : [];
        const simp = coords.length > 10000 ? coords.filter((_,i)=> (i%2===0)) : rdpLine(coords, eps);
        out.push(simp);
      }
      return { type:'MultiLineString', coordinates: out };
    }
  }catch{}
  return geom;
}

async function writeCountryTopo(iso3, feats){
  const dir = path.join(DATA_DIR, iso3);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'roads.geojson');
  const writer = createGeoJSONStreamWriter(file);
  writer.append(feats);
  writer.end();
  return file;
}

// --- Optional clip-to-outline (same as rivers) ---
function pointInRing(pt, ring){
  let inside=false; const n=ring.length;
  for(let i=0,j=n-1;i<n;j=i++){
    const xi=ring[i][0], yi=ring[i][1], xj=ring[j][0], yj=ring[j][1];
    const intersect=((yi>pt[1])!==(yj>pt[1])) && (pt[0] < (xj-xi)*(pt[1]-yi)/((yj-yi)||1e-12)+xi);
    if(intersect) inside=!inside;
  }
  return inside;
}
function pointInPolygon(pt, poly){
  if(!Array.isArray(poly)||!poly.length) return false;
  if(!pointInRing(pt, poly[0])) return false;
  for(let k=1;k<poly.length;k++) if(pointInRing(pt, poly[k])) return false;
  return true;
}
function pointInMultiPolygon(pt, mp){
  const polys=Array.isArray(mp)?mp:[];
  for(const poly of polys){ if(pointInPolygon(pt, poly)) return true; }
  return false;
}
function clipLineStringToMultiPolygon(coords, mp){
  const segs=[]; let cur=[];
  for(const c of (coords||[])){
    if(pointInMultiPolygon(c, mp)) cur.push(c); else { if(cur.length>=2) segs.push(cur); cur=[]; }
  }
  if(cur.length>=2) segs.push(cur);
  if(!segs.length) return null;
  if(segs.length===1) return { type:'LineString', coordinates: segs[0] };
  return { type:'MultiLineString', coordinates: segs };
}
function toMultiPolygonFromOutline(iso3){
  try{
    const p = path.join(DATA_DIR, iso3, 'outline.geojson');
    const gj = JSON.parse(fs.readFileSync(p,'utf8'));
    const g = gj && gj.type==='FeatureCollection' ? (gj.features||[])[0]?.geometry : (gj && gj.type==='Feature' ? gj.geometry : gj);
    if(!g) return null;
    if(g.type==='MultiPolygon') return g.coordinates;
    if(g.type==='Polygon') return [g.coordinates];
  }catch{}
  return null;
}

function subdivideBbox([s,w,n,e]){
  const mlat = +( (s+n)/2 ).toFixed(6);
  const mlon = +( (w+e)/2 ).toFixed(6);
  return [
    [s, w, mlat, mlon],
    [s, mlon, mlat, e],
    [mlat, w, n, mlon],
    [mlat, mlon, n, e]
  ];
}

async function processTile(bb, opts, depth=0){
  const { includeSecondary, includeRail, simplifyKm, sleepMs, iso3, clipToOutlineMP } = opts;
  try{
    const osm = await fetchOverpass(bb, includeSecondary, includeRail, { attempts: 6, retryDelayMs: 2500 }, iso3);
    const gj = osmToGeoJSON(osm, opts.seen);
    let feats = (gj && gj.features) ? gj.features : [];
    if (clipToOutlineMP) {
      const clipped=[];
      for(const f of feats){
        const cg = clipGeometryToMP(f.geometry, clipToOutlineMP);
        if(cg) clipped.push({ type:'Feature', properties:f.properties||{}, geometry: cg });
      }
      feats = clipped;
    }
    if(simplifyKm>0){
      feats = feats.map(f=> ({ ...f, geometry: simplifyGeometry(f.geometry, simplifyKm) }));
    }
    return feats;
  }catch(err){
    // Fallback strategy: split tile and retry (up to 2 levels), then reduce detail
    if(depth < 2){
      const subs = subdivideBbox(bb);
      let out = [];
      for(const sub of subs){
        try{
          const part = await processTile(sub, opts, depth+1);
          out = out.concat(part);
        }catch(e){ /* swallow */ }
        if(sleepMs) await sleep(sleepMs);
      }
      if(out.length) return out;
    }
    // Last resort: retry with stricter filters (no secondary/rail) and stronger simplify
    try{
      const fallback = { includeSecondary:false, includeRail:false, simplifyKm: Math.max(simplifyKm, 1), sleepMs, seen: opts.seen, iso3, clipToOutlineMP };
      const osm2 = await fetchOverpass(bb, false, false, { attempts: 4, retryDelayMs: 3000 }, iso3);
      const gj2 = osmToGeoJSON(osm2, opts.seen);
      let feats2 = (gj2 && gj2.features) ? gj2.features : [];
      if (clipToOutlineMP) {
        const clipped=[];
        for(const f of feats2){
          const cg = clipGeometryToMP(f.geometry, clipToOutlineMP);
          if(cg) clipped.push({ type:'Feature', properties:f.properties||{}, geometry: cg });
        }
        feats2 = clipped;
      }
      feats2 = feats2.map(f=> ({ ...f, geometry: simplifyGeometry(f.geometry, fallback.simplifyKm) }));
      return feats2;
    }catch{
      return [];
    }
  }
}

async function main(){
  const argv = process.argv.slice(2);
  const includeSecondary = argv.includes('--include-secondary');
  const includeRail = argv.includes('--include-rail');
  const tileDegArg = argv.find(a=>a.startsWith('--tile-deg='));
  const tileDeg = tileDegArg ? Math.max(1, Math.min(20, Number(tileDegArg.split('=')[1])||10)) : 10;
  const sleepArg = argv.find(a=>a.startsWith('--sleep='));
  const sleepMs = sleepArg ? Math.max(0, Number(sleepArg.split('=')[1])||1500) : 1500;
  const simpArg = argv.find(a=>a.startsWith('--simplify-km='));
  const simplifyKm = simpArg ? Math.max(0, Number(simpArg.split('=')[1])||0) : 0;
  const minBytesArg = argv.find(a=>a.startsWith('--min-bytes='));
  const minBytes = minBytesArg ? Math.max(1, Number(minBytesArg.split('=')[1])||1024) : 1024;
  const force = argv.includes('--force');
  const targets = argv.filter(a=>/^[A-Z]{3}$/.test(a));
  const list = targets.length ? targets : getCountryList();
  let banner = `Fetching topo lines for ${list.length} countries...`;
  if(includeSecondary) banner += ' +secondary';
  if(includeRail) banner += ' +rail';
  if(simplifyKm) banner += ` simplify~${simplifyKm}km`;
  banner += force ? ' (force overwrite)' : ' (skip existing)';
  console.log(banner);
  for(const iso3 of list){
    try{
      const bbox = geojsonBbox(getCountryOutline(iso3));
      console.log(`→ ${iso3} bbox:`, bbox.map(n=>+n.toFixed(4)).join(','));
      // Skip if we already have a reasonably sized output, unless --force
      const outPath = path.join(DATA_DIR, iso3, 'roads.geojson');
      if(!force){
        try{
          const st = fs.statSync(outPath);
          if(st && st.isFile() && st.size >= minBytes){
            console.log(`  ${iso3}: exists (${st.size} bytes) — skipping. Use --force to overwrite or --min-bytes to adjust.`);
            await sleep(sleepMs);
            continue;
          }
        }catch{}
      }
      const clipToOutline = argv.includes('--clip-to-outline');
      const clipMP = clipToOutline ? toMultiPolygonFromOutline(iso3) : null;
      const tiles = splitBbox(bbox, tileDeg);
      const seen = new Set();
      let total = 0;
      // Stream output per tile to avoid large in-memory arrays
      const outDir = path.join(DATA_DIR, iso3);
      fs.mkdirSync(outDir, { recursive:true });
      const writer = createGeoJSONStreamWriter(outPath);
      for(let i=0;i<tiles.length;i++){
        const bb = tiles[i];
        const feats = await processTile(bb, { includeSecondary, includeRail, simplifyKm, sleepMs, seen, iso3, clipToOutlineMP: clipMP });
        writer.append(feats);
        total += feats.length;
        console.log(`   tile ${i+1}/${tiles.length}: +${feats.length} features`);
        await sleep(sleepMs);
      }
      writer.end();
      console.log(`  ${iso3}: wrote ${total} features to ${outPath}`);
    }catch(err){
      console.error(`  ${iso3}: failed:`, err && err.message || err);
    }
  }
  console.log('Done');
}

main().catch(e=>{ console.error('FATAL', e && e.message || e); process.exit(1); });
