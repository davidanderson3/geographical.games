#!/usr/bin/env node
/*
  Generate lightweight "topo" line overlays per country by drawing a simple
  graticule (parallel/meridian hatch) clipped to each country's outline.

  This is a placeholder for real elevation contours (which require DEMs).
  It produces LineString/MultiLineString features in elevation.geojson so the
  game can show a "topo lines" round even when no elevation data exists.

  Usage:
    node scripts/generateTopoLines.js              # all countries missing elevation.geojson
    node scripts/generateTopoLines.js MEX BRA USA  # specific ISO3s

  Options via env/flags:
    --step-deg=0.75   Spacing in degrees between lines (default 1.0)
    --both            Draw both parallels (lat) and meridians (lon) (default parallels only)
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'geolayers-game', 'public', 'data');
const COUNTRIES_FILE = path.join(ROOT, 'geolayers-game', 'public', 'countries.json');

function readJson(p){ return JSON.parse(fs.readFileSync(p, 'utf8')); }
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

function getISO3List(){
  try { return readJson(COUNTRIES_FILE).map(r=>r.code); } catch { return []; }
}

function getOutline(iso3){
  const p = path.join(DATA_DIR, iso3, 'outline.geojson');
  if(!fs.existsSync(p)) return null;
  try { return readJson(p); } catch { return null; }
}

// Basic geometry helpers (lon/lat)
function pointInRing(pt, ring){
  let inside = false; const n = ring.length;
  for(let i=0, j=n-1; i<n; j=i++){
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi>pt[1]) !== (yj>pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / ((yj - yi) || 1e-12) + xi);
    if(intersect) inside = !inside;
  }
  return inside;
}
function pointInPolygon(pt, poly){
  if(!Array.isArray(poly) || !poly.length) return false;
  if(!pointInRing(pt, poly[0])) return false;
  for(let k=1;k<poly.length;k++) if(pointInRing(pt, poly[k])) return false;
  return true;
}
function pointInMultiPolygon(pt, mp){
  const polys = Array.isArray(mp) ? mp : [];
  for(const poly of polys){ if(pointInPolygon(pt, poly)) return true; }
  return false;
}
function clipLineToMP(coords, mp){
  const out=[]; let cur=[];
  for(const c of coords){
    if(pointInMultiPolygon(c, mp)) cur.push(c); else { if(cur.length>=2) out.push(cur); cur=[]; }
  }
  if(cur.length>=2) out.push(cur);
  if(!out.length) return null;
  if(out.length===1) return { type:'LineString', coordinates: out[0] };
  return { type:'MultiLineString', coordinates: out };
}

function toMultiPolygon(gj){
  const g = gj && gj.type==='FeatureCollection' ? (gj.features||[])[0]?.geometry : (gj && gj.type==='Feature' ? gj.geometry : gj);
  if(!g) return null;
  if(g.type==='MultiPolygon') return g.coordinates;
  if(g.type==='Polygon') return [g.coordinates];
  return null;
}

function bboxOfMP(mp){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  const walk=(c)=>{ if(Array.isArray(c[0])) c.forEach(walk); else { const x=+c[0], y=+c[1]; if(x<minX)minX=x; if(y<minY)minY=y; if(x>maxX)maxX=x; if(y>maxY)maxY=y; } };
  for(const poly of mp) for(const ring of poly) walk(ring);
  return [minX,minY,maxX,maxY];
}

function generateLinesForMP(mp, stepDeg=1.0, both=false){
  const [minX,minY,maxX,maxY] = bboxOfMP(mp);
  const feats=[];
  const push = (geom)=>{ if(geom) feats.push({ type:'Feature', properties:{}, geometry: geom }); };
  // Parallels (lat)
  for(let y=Math.ceil(minY/stepDeg)*stepDeg; y<=maxY; y+=stepDeg){
    const coords=[];
    for(let x=minX; x<=maxX; x+=Math.max(stepDeg/4, 0.25)) coords.push([+x.toFixed(6), +y.toFixed(6)]);
    push(clipLineToMP(coords, mp));
  }
  if(both){
    for(let x=Math.ceil(minX/stepDeg)*stepDeg; x<=maxX; x+=stepDeg){
      const coords=[];
      for(let y=minY; y<=maxY; y+=Math.max(stepDeg/4, 0.25)) coords.push([+x.toFixed(6), +y.toFixed(6)]);
      push(clipLineToMP(coords, mp));
    }
  }
  return feats.filter(Boolean);
}

function writeElevation(iso3, feats){
  const dir = path.join(DATA_DIR, iso3);
  fs.mkdirSync(dir, { recursive:true });
  const file = path.join(dir, 'elevation.geojson');
  const gj = { type:'FeatureCollection', features: feats };
  fs.writeFileSync(file, JSON.stringify(gj));
  return file;
}

async function main(){
  const argv = process.argv.slice(2);
  const stepArg = argv.find(a=>a.startsWith('--step-deg='));
  const stepDeg = stepArg ? Math.max(0.1, Number(stepArg.split('=')[1])||1.0) : 1.0;
  const both = argv.includes('--both');
  const targets = argv.filter(a=>/^[A-Z]{3}$/.test(a));
  const list = targets.length ? targets : getISO3List();
  console.log(`Generating topo lines for ${list.length} countries (step=${stepDeg}°, both=${both})`);
  for(const iso3 of list){
    try{
      const outPath = path.join(DATA_DIR, iso3, 'elevation.geojson');
      if(fs.existsSync(outPath)) { console.log(`  ${iso3}: elevation exists — skipping`); continue; }
      const outline = getOutline(iso3);
      if(!outline){ console.warn(`  ${iso3}: no outline — skipping`); continue; }
      const mp = toMultiPolygon(outline);
      if(!mp){ console.warn(`  ${iso3}: outline not polygon — skipping`); continue; }
      const feats = generateLinesForMP(mp, stepDeg, both);
      const file = writeElevation(iso3, feats);
      console.log(`  ${iso3}: wrote ${feats.length} lines to ${file}`);
      await sleep(100);
    }catch(e){
      console.error(`  ${iso3}: failed:`, e && e.message || e);
    }
  }
  console.log('Done.');
}

main().catch(e=>{ console.error('FATAL', e && e.message || e); process.exit(1); });

