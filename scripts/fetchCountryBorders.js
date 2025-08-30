#!/usr/bin/env node
/*
  Fetch country borders (outlines) for each ISO3 in geolayers-game/public/countries.json
  from Natural Earth 10m admin_0 countries, and write per-country outline.geojson.

  - Downloads and caches the NE dataset locally on first run
  - Merges all matching parts into a single MultiPolygon per country
  - Optional simplification to reduce vertices (Douglas–Peucker)

  Flags:
    --simplify-km=K   Simplify rings with ~K km tolerance (default 0 = no simplify)
    --sleep=MS        Delay between countries (default 200ms)

  Usage:
    node scripts/fetchCountryBorders.js            # all ISO3
    node scripts/fetchCountryBorders.js USA MEX    # specific ISO3
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'geolayers-game', 'public', 'data');
const COUNTRIES_FILE = path.join(ROOT, 'geolayers-game', 'public', 'countries.json');

const NE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson';
const NE_CACHE = path.join(__dirname, 'ne_10m_admin_0_countries.geojson');

function readJson(p){ return JSON.parse(fs.readFileSync(p, 'utf8')); }
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

function getISO3List(){
  const arr = readJson(COUNTRIES_FILE);
  return arr.map(r=>r.code);
}

async function ensureNE(){
  if (fs.existsSync(NE_CACHE)) return;
  const res = await fetch(NE_URL);
  if(!res.ok){
    const t = await res.text().catch(()=>String(res.status));
    throw new Error(`Download failed: ${res.status} ${t}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(NE_CACHE, buf);
}

// Geometry helpers
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
    const [first, last] = stack.pop();
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
  if(out.length < 2) return [coords[0], coords[coords.length-1]];
  return out;
}

function closeRing(r){
  if(!r || r.length<3) return r;
  const first = r[0], last = r[r.length-1];
  if(first[0]!==last[0] || first[1]!==last[1]) r = r.concat([[first[0], first[1]]]);
  return r;
}

function simplifyPolygon(poly, epsDeg){
  // poly: array of rings
  const out=[];
  for(const ring of (poly||[])){
    if(!Array.isArray(ring) || ring.length<4) continue;
    let coords = ring;
    // ensure open path without duplicate end for RDP
    const open = ring[0][0]===ring[ring.length-1][0] && ring[0][1]===ring[ring.length-1][1] ? ring.slice(0,-1) : ring.slice();
    let simp;
    try {
      simp = open.length > 20000 ? open.filter((_,i)=> (i%2===0)) : rdpLine(open, epsDeg);
    } catch {
      simp = open;
    }
    // ensure at least 3 unique + closing point
    if(simp.length<3) continue;
    simp = closeRing(simp);
    out.push(simp);
  }
  return out.length ? out : null;
}

function mergeGeometriesToMultiPolygon(features, simplifyKm){
  const eps = simplifyKm>0 ? approxDegFromKm(simplifyKm) : 0;
  const polys=[];
  for(const f of features){
    if(!f || !f.geometry) continue;
    const g = f.geometry;
    if(g.type==='Polygon'){
      const simp = eps>0 ? simplifyPolygon(g.coordinates, eps) : g.coordinates;
      if(simp && simp.length) polys.push(simp);
    } else if(g.type==='MultiPolygon'){
      for(const poly of (g.coordinates||[])){
        const simp = eps>0 ? simplifyPolygon(poly, eps) : poly;
        if(simp && simp.length) polys.push(simp);
      }
    }
  }
  return { type:'MultiPolygon', coordinates: polys };
}

async function writeOutline(iso3, geom){
  const dir = path.join(DATA_DIR, iso3);
  fs.mkdirSync(dir, { recursive:true });
  const file = path.join(dir, 'outline.geojson');
  const gj = { type:'FeatureCollection', features: [{ type:'Feature', properties:{ iso3: iso3 }, geometry: geom }] };
  fs.writeFileSync(file, JSON.stringify(gj));
  return file;
}

async function main(){
  const argv = process.argv.slice(2);
  const simpArg = argv.find(a=>a.startsWith('--simplify-km='));
  const simplifyKm = simpArg ? Math.max(0, Number(simpArg.split('=')[1])||0) : 0;
  const sleepArg = argv.find(a=>a.startsWith('--sleep='));
  const sleepMs = sleepArg ? Math.max(0, Number(sleepArg.split('=')[1])||200) : 200;
  const targets = argv.filter(a=>/^[A-Z]{3}$/.test(a));
  await ensureNE();
  const ne = readJson(NE_CACHE);
  const rows = Array.isArray(ne?.features) ? ne.features : [];
  const list = targets.length ? targets : getISO3List();
  console.log(`Building borders for ${list.length} countries...${simplifyKm?` simplify~${simplifyKm}km`:''}`);
  for(const code of list){
    try{
      // match by ADM0_A3 or ISO_A3
      const subset = rows.filter(f => f && f.properties && (f.properties.ADM0_A3===code || f.properties.ISO_A3===code));
      if(!subset.length){
        console.warn(`  ${code}: not found in Natural Earth (ADM0_A3/ISO_A3)`);
        continue;
      }
      const geom = mergeGeometriesToMultiPolygon(subset, simplifyKm);
      const file = await writeOutline(code, geom);
      console.log(`  ${code}: wrote outline to ${file}`);
    }catch(err){
      console.error(`  ${code}: failed:`, err && err.message || err);
    }
    await sleep(sleepMs);
  }
  console.log('Done');
}

main().catch(e=>{ console.error('FATAL', e && e.message || e); process.exit(1); });
