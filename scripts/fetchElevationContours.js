#!/usr/bin/env node
/*
  Fetch real elevation contours per country by sampling open Terrarium tiles
  (elevation-tiles-prod) and extracting contour lines via d3-contour.

  Output: geolayers-game/public/data/<ISO3>/elevation.geojson (LineString/MultiLineString)

  Sustainable: runs offline at build time; serves static GeoJSON at runtime.
  Recognizable: produces actual elevation isolines (e.g., every 500m).

  Usage:
    node scripts/fetchElevationContours.js               # all countries missing elevation.geojson
    node scripts/fetchElevationContours.js MEX USA       # specific ISO3 codes

  Options:
    --zoom=8            Terrarium tile zoom (default 8; 7=coarser, 9=finer)
    --interval=500      Elevation interval in meters (default 500)
    --both              Generate both positive and negative contours
    --force             Overwrite existing elevation.geojson

  Notes:
    - Uses AWS elevation-tiles Terrarium: https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
    - Terrarium decode: elevation = R*256 + G + B/256 - 32768 (meters)
*/

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const d3c = require('d3-contour');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'geolayers-game', 'public', 'data');
const COUNTRIES_FILE = path.join(ROOT, 'geolayers-game', 'public', 'countries.json');

function readJson(p){ return JSON.parse(fs.readFileSync(p, 'utf8')); }
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

function getISO3List(){ try { return readJson(COUNTRIES_FILE).map(r=>r.code); } catch { return []; } }
function getOutline(iso3){ try { return readJson(path.join(DATA_DIR, iso3, 'outline.geojson')); } catch { return null; } }

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

// Web Mercator tile helpers
function lonLatToTile(lon, lat, z){
  const n = 2**z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = lat * Math.PI/180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1/Math.cos(latRad)) / Math.PI) / 2 * n);
  return [x,y];
}
function tileBounds(x, y, z){
  const n = 2**z;
  const lon1 = x / n * 360 - 180;
  const lon2 = (x+1)/n * 360 - 180;
  const latRad1 = Math.atan(Math.sinh(Math.PI * (1 - 2*y/n)));
  const latRad2 = Math.atan(Math.sinh(Math.PI * (1 - 2*(y+1)/n)));
  const lat1 = latRad1*180/Math.PI, lat2 = latRad2*180/Math.PI;
  return [lon1, lat2, lon2, lat1]; // [minLon, minLat, maxLon, maxLat]
}
function pixelToLonLat(z, x, y, i, j){
  const n = 2**z;
  const px = x*256 + i + 0.5;
  const py = y*256 + j + 0.5;
  const lon = px / (n*256) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2*py/(n*256))));
  const lat = latRad * 180/Math.PI;
  return [lon, lat];
}

async function fetchPNG(url){
  const res = await fetch(url);
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return PNG.sync.read(buf);
}

function terrariumToElevation(r,g,b){ return (r*256 + g + b/256) - 32768; }

async function buildGrid(mp, z){
  const [minLon,minLat,maxLon,maxLat] = bboxOfMP(mp);
  const [minX,minY] = lonLatToTile(minLon, maxLat, z);
  const [maxX,maxY] = lonLatToTile(maxLon, minLat, z);
  const width = (maxX-minX+1)*256;
  const height = (maxY-minY+1)*256;
  const values = new Float32Array(width*height);
  values.fill(NaN);
  for(let ty=minY; ty<=maxY; ty++){
    for(let tx=minX; tx<=maxX; tx++){
      const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`;
      let png; try { png = await fetchPNG(url); } catch { continue; }
      const ox = (tx-minX)*256; const oy = (ty-minY)*256;
      for(let j=0;j<png.height;j++){
        for(let i=0;i<png.width;i++){
          const idx = (j*png.width + i) << 2;
          const r = png.data[idx], g = png.data[idx+1], b = png.data[idx+2];
          const elev = terrariumToElevation(r,g,b);
          // Mask oceans as NaN (negative elevations acceptable, but keep them)
          const gx = ox + i, gy = oy + j;
          values[gy*width + gx] = elev;
        }
      }
      await sleep(50);
    }
  }
  return { values, width, height, minX, minY };
}

function contoursToLineFeatures(contour, z, minX, minY){
  // Convert MultiPolygon geometry from d3-contour to LineString rings in lon/lat
  const feats = [];
  const polys = contour.coordinates || [];
  for(const poly of polys){
    for(const ring of poly){
      const line = [];
      for(const pt of ring){
        const i = pt[0], j = pt[1];
        const px = Math.max(0, Math.min(256, i));
        const py = Math.max(0, Math.min(256, j));
      }
    }
  }
  // We'll map grid coords later; d3 returns positions in grid pixels relative to the full raster
  return feats;
}

function contoursToGeoJSON(contours, z, minX, minY){
  // d3-contour returns polygon rings in grid coordinates. We convert each ring to a LineString by mapping grid pixel to lon/lat.
  const feats = [];
  for(const c of contours){
    const level = c.value;
    for(const poly of c.coordinates){
      for(const ring of poly){
        const coords = ring.map(([gx, gy]) => {
          const x = Math.floor(gx) / 256 + minX; // tile x with pixel fraction
          const y = Math.floor(gy) / 256 + minY; // tile y with pixel fraction
          const i = Math.floor(gx) % 256;
          const j = Math.floor(gy) % 256;
          const lonlat = pixelToLonLat(z, Math.floor(x), Math.floor(y), i, j);
          return lonlat;
        });
        feats.push({ type:'Feature', properties:{ level }, geometry:{ type:'LineString', coordinates: coords } });
      }
    }
  }
  return { type:'FeatureCollection', features: feats };
}

async function main(){
  const argv = process.argv.slice(2);
  const zArg = argv.find(a=>a.startsWith('--zoom='));
  const intervalArg = argv.find(a=>a.startsWith('--interval='));
  const zoom = zArg ? Math.max(6, Math.min(11, Number(zArg.split('=')[1])||8)) : 8;
  const interval = intervalArg ? Math.max(50, Number(intervalArg.split('=')[1])||500) : 500;
  const both = argv.includes('--both');
  const force = argv.includes('--force');
  const targets = argv.filter(a=>/^[A-Z]{3}$/.test(a));
  const list = targets.length ? targets : getISO3List();

  console.log(`Generating elevation contours (zoom=${zoom}, interval=${interval}m) for ${list.length} countries...`);
  for(const iso3 of list){
    try{
      const outPath = path.join(DATA_DIR, iso3, 'elevation.geojson');
      if(!force && fs.existsSync(outPath)) { console.log(`  ${iso3}: elevation exists — skipping`); continue; }
      const outline = getOutline(iso3);
      const mp = outline ? toMultiPolygon(outline) : null;
      if(!mp){ console.warn(`  ${iso3}: missing/invalid outline — skipping`); continue; }
      const { values, width, height, minX, minY } = await buildGrid(mp, zoom);
      // Build thresholds from min to max using interval
      let vmin=Infinity, vmax=-Infinity;
      for(let k=0;k<values.length;k++){ const v = values[k]; if(Number.isFinite(v)){ if(v<vmin)vmin=v; if(v>vmax)vmax=v; } }
      if(!Number.isFinite(vmin) || !Number.isFinite(vmax)) { console.warn(`  ${iso3}: no elevation values — skipping`); continue; }
      const thresholds=[];
      const start = Math.ceil(vmin/interval)*interval;
      const end = Math.floor(vmax/interval)*interval;
      for(let t=start; t<=end; t+=interval) thresholds.push(t);
      if(both && vmin<0){ for(let t=0-interval; t>=vmin; t-=interval) thresholds.push(t); }
      thresholds.sort((a,b)=>a-b);
      const contours = d3c.contours().size([width, height]).thresholds(thresholds)(values);
      const fc = contoursToGeoJSON(contours, zoom, minX, minY);
      fs.mkdirSync(path.join(DATA_DIR, iso3), { recursive:true });
      fs.writeFileSync(outPath, JSON.stringify(fc));
      console.log(`  ${iso3}: wrote ${fc.features.length} lines to ${outPath}`);
      await sleep(200);
    }catch(e){
      console.error(`  ${iso3}: failed:`, e && e.message || e);
    }
  }
  console.log('Done');
}

main().catch(e=>{ console.error('FATAL', e && e.message || e); process.exit(1); });

