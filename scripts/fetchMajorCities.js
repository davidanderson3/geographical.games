#!/usr/bin/env node
/*
  Fetch a "major cities" point layer per country using Wikidata and
  write GeoJSON to geolayers-game/public/data/<ISO3>/cities.geojson.

  Defaults:
    - Top 25 cities by population (if present)
    - Only instances/subclasses of City (Q515)
    - Ensures the national capital is included if it has coordinates

  Flags:
    --limit=NUM         Max cities per country (default 25)
    --min-pop=NUM       Minimum population (numeric, default 0)
    --sleep=MS          Delay between countries in ms (default 400)

  Usage:
    node scripts/fetchMajorCities.js            # all ISO3 in countries.json
    node scripts/fetchMajorCities.js USA MEX    # specific ISO3

  Requires Node 18+ (global fetch) and no external deps.
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'geolayers-game', 'public', 'data');
const COUNTRIES_FILE = path.join(ROOT, 'geolayers-game', 'public', 'countries.json');
const NE_PLACES_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson';
const NE_CACHE = path.join(__dirname, 'ne_10m_populated_places_simple.geojson');
const NE_ADMIN_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson';
const NE_ADMIN_CACHE = path.join(__dirname, 'ne_10m_admin_0_countries.geojson');

function readJson(p){ return JSON.parse(fs.readFileSync(p, 'utf8')); }
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

function getCountryList(){
  const arr = readJson(COUNTRIES_FILE);
  return arr.map(r=>r.code);
}

function parsePointWKT(wkt){
  // e.g., "Point(-99.1332 19.4326)"
  const m = /Point\(([-\d\.eE]+)\s+([-\d\.eE]+)\)/.exec(wkt||'');
  if(!m) return null;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  if(!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
}

function getOutlinePath(iso3){
  return path.join(DATA_DIR, iso3, 'outline.geojson');
}

function geojsonBbox(gj){
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  function add(x,y){ if(x<minX)minX=x; if(y<minY)minY=y; if(x>maxX)maxX=x; if(y>maxY)maxY=y; }
  function walk(c){
    if(!c) return;
    if(typeof c[0]==='number' && typeof c[1]==='number'){ add(c[0],c[1]); return; }
    for(const e of c) walk(e);
  }
  if(gj.type==='FeatureCollection'){ for(const f of gj.features||[]){ if(f&&f.geometry) walk(f.geometry.coordinates); } }
  else if(gj.type==='Feature' && gj.geometry) walk(gj.geometry.coordinates);
  else if(gj.type) walk(gj.coordinates);
  if(!isFinite(minX)||!isFinite(minY)||!isFinite(maxX)||!isFinite(maxY)) throw new Error('bbox failed');
  return [minY,minX,maxY,maxX];
}

async function fetchOverpassCities(bbox, limit){
  const [s,w,n,e] = bbox;
  const endpoints = [
    process.env.OVERPASS_URL,
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ].filter(Boolean);
  const q = `
[out:json][timeout:120];
(
  node["place"~"^(city|town)$"]["name"]["population"](${s},${w},${n},${e});
  node["place"~"^(city)$"]["name"](${s},${w},${n},${e});
);
out body;
`;
  let delay=1500;
  for(let i=0;i<6;i++){
    const url = endpoints[i % endpoints.length];
    try{
      const res = await fetch(url, { method:'POST', body:q, headers:{'Content-Type':'text/plain'} });
      if(!res.ok){ const t=await res.text().catch(()=>res.statusText); if(res.status===429||/rate_limited/i.test(t||'')){ await sleep(delay); delay=Math.min(delay*1.8, 15000); continue; } throw new Error(`Overpass ${res.status}: ${t}`); }
      const osm = await res.json();
      const els = Array.isArray(osm?.elements)?osm.elements:[];
      // Sort by population desc, then by presence of population
      els.sort((a,b)=> (Number(b.tags?.population)||0) - (Number(a.tags?.population)||0));
      const out=[]; const seen=new Set();
      for(const el of els){
        if(out.length>=limit) break;
        const name = el.tags?.name; const lon=Number(el.lon), lat=Number(el.lat);
        if(!name || !Number.isFinite(lon)||!Number.isFinite(lat)) continue;
        const pop = Number(el.tags?.population)||0;
        const key = `${name.toLowerCase()}@${lon.toFixed(3)},${lat.toFixed(3)}`;
        if(seen.has(key)) continue; seen.add(key);
        out.push({ type:'Feature', properties:{ name, population: pop, source:'OSM' }, geometry:{ type:'Point', coordinates:[lon,lat] } });
      }
      return out;
    }catch(err){ await sleep(delay); delay=Math.min(delay*1.8, 15000); }
  }
  return [];
}

async function fetchCitiesForISO3(iso3, limit=25, minPop=0, opts={}){
  const endpoint = 'https://query.wikidata.org/sparql';
  const ua = { 'Accept':'application/sparql-results+json', 'User-Agent':'geo-layers-city-fetch/1.0 (contact: dashboard app)' };
  const feats = [];
  const seenKey = new Set(); // dedupe by rounded coord + lowercase name

  function addFeature(name, lon, lat, population, extraProps){
    if(!Number.isFinite(lon) || !Number.isFinite(lat) || !name) return false;
    if(population < minPop) return false;
    const key = `${name.toLowerCase()}@${lon.toFixed(3)},${lat.toFixed(3)}`;
    if(seenKey.has(key)) return false;
    feats.push({ type:'Feature', properties:{ name, population: Number.isFinite(population)?population:null, ...(extraProps||{}) }, geometry:{ type:'Point', coordinates:[lon,lat] } });
    seenKey.add(key);
    return true;
  }

  async function runQuery(q){
    const url = endpoint + '?format=json&query=' + encodeURIComponent(q);
    const res = await fetch(url, { headers: ua });
    if(!res.ok){
      const t = await res.text().catch(()=>String(res.status));
      throw new Error(`SPARQL ${res.status}: ${t}`);
    }
    const data = await res.json();
    const rows = Array.isArray(data?.results?.bindings) ? data.results.bindings : [];
    for(const b of rows){
      if(feats.length >= limit) break;
      const id = String(b.city?.value||'');
      if(!id) continue;
      const coord = parsePointWKT(b.coord?.value);
      if(!coord) continue;
      const pop = b.population ? Number(b.population.value) : 0;
      if(pop < minPop) continue;
      const name = b.cityLabel?.value || id.split('/').pop();
      // rely on addFeature (name+coord) to handle de-dup across sources
      addFeature(name, coord[0], coord[1], Number.isFinite(pop)?pop:null, { source:'wikidata' });
    }
  }

  // 0) Natural Earth as primary source (fast, broad coverage)
  try {
    if(!fs.existsSync(NE_CACHE)){
      const r = await fetch(NE_PLACES_URL);
      if(!r.ok) throw new Error(`NE download HTTP ${r.status}`);
      const buf = await r.arrayBuffer();
      fs.writeFileSync(NE_CACHE, Buffer.from(buf));
    }
    const ne = JSON.parse(fs.readFileSync(NE_CACHE, 'utf8'));
    const rows = Array.isArray(ne?.features) ? ne.features : [];
    const subset = rows.filter(f => {
      const p = f && f.properties ? f.properties : null;
      if(!p) return false;
      const candidates = [
        p.ADM0_A3, p.adm0_a3,
        p.ISO_A3,  p.iso_a3,
        p.SOV_A3,  p.sov_a3,
        p.ADM0_A3_US, p.adm0_a3_us,
        p.ADM0_A3_UN, p.adm0_a3_un,
        p.ISO_A2, p.iso_a2
      ];
      return candidates.some(v => typeof v === 'string' && v.toUpperCase() === iso3);
    });
    subset.sort((a,b)=> (Number(b.properties?.POP_MAX ?? b.properties?.pop_max)||0) - (Number(a.properties?.POP_MAX ?? a.properties?.pop_max)||0));
    for(const f of subset){
      if(feats.length >= limit) break;
      const g = f.geometry;
      if(!g || g.type !== 'Point' || !Array.isArray(g.coordinates)) continue;
      const lon = Number(g.coordinates[0]), lat = Number(g.coordinates[1]);
      const pop = Number(f.properties?.POP_MAX ?? f.properties?.pop_max)||0;
      const name = f.properties?.NAME || f.properties?.name || f.properties?.NAMEASCII || f.properties?.nameascii || null;
      addFeature(name, lon, lat, pop, { source:'NE10m' });
    }
    if(feats.length === 0) {
      console.warn(`  ${iso3}: NE places matched 0 features`);
    }
  } catch {}

  // 1) Strict: City (Q515) top-up to limit (unless --ne-only)
  if(!opts.neOnly && feats.length < limit){
    const qCity = `
SELECT ?city ?cityLabel ?population ?coord WHERE {
  ?country wdt:P298 "${iso3}".
  ?city (wdt:P31/wdt:P279*) wd:Q515; wdt:P17 ?country; wdt:P625 ?coord.
  OPTIONAL { ?city wdt:P1082 ?population. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY DESC(?population)
LIMIT ${Math.max(1, limit * 5)}
`;
    try { await runQuery(qCity); } catch (e) { console.warn(`  ${iso3}: Wikidata city query failed:`, e && e.message || e); }
  }

  // 2) Broader: Human settlement (Q486972) to fill up to limit
  if(!opts.neOnly && feats.length < limit){
    const qSettlement = `
SELECT ?city ?cityLabel ?population ?coord WHERE {
  ?country wdt:P298 "${iso3}".
  ?city (wdt:P31/wdt:P279*) wd:Q486972; wdt:P17 ?country; wdt:P625 ?coord.
  OPTIONAL { ?city wdt:P1082 ?population. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY DESC(?population)
LIMIT ${Math.max(1, limit * 5)}
`;
    try { await runQuery(qSettlement); } catch (e) { console.warn(`  ${iso3}: Wikidata settlement query failed:`, e && e.message || e); }
  }

  // 3) Ensure capital is present
  try {
    const capQuery = `
SELECT ?cap ?capLabel ?coord WHERE {
  ?country wdt:P298 "${iso3}"; wdt:P36 ?cap.
  ?cap wdt:P625 ?coord.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 1`;
    const capUrl = endpoint + '?format=json&query=' + encodeURIComponent(capQuery);
    const capRes = await fetch(capUrl, { headers: ua });
    if(capRes.ok){
      const cap = await capRes.json();
      const br = cap?.results?.bindings?.[0];
      if(br){
        const ccoord = parsePointWKT(br.coord?.value);
        const cid = String(br.cap?.value||'');
        if(ccoord && cid && !seenIds.has(cid)){
          addFeature(br.capLabel?.value || cid.split('/').pop(), ccoord[0], ccoord[1], null, { capital:true, source:'wikidata' });
        }
      }
    }
  } catch {}
  return feats;
}

async function writeCountryCities(iso3, feats){
  const dir = path.join(DATA_DIR, iso3);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'cities.geojson');
  if(!Array.isArray(feats) || feats.length===0){
    // Avoid overwriting an existing non-empty file with empty results
    if(fs.existsSync(file)) return file;
    const empty = { type:'FeatureCollection', features: [] };
    fs.writeFileSync(file, JSON.stringify(empty));
    return file;
  }
  const gj = { type:'FeatureCollection', features: feats };
  fs.writeFileSync(file, JSON.stringify(gj));
  return file;
}

async function main(){
  const argv = process.argv.slice(2);
  const limitArg = argv.find(a=>a.startsWith('--limit='));
  const minPopArg = argv.find(a=>a.startsWith('--min-pop='));
  const sleepArg = argv.find(a=>a.startsWith('--sleep='));
  const minBytesArg = argv.find(a=>a.startsWith('--min-bytes='));
  const force = argv.includes('--force');
  const limit = limitArg ? Math.max(1, Number(limitArg.split('=')[1])||25) : 25;
  const minPop = minPopArg ? Math.max(0, Number(minPopArg.split('=')[1])||0) : 0;
  const waitMs = sleepArg ? Math.max(0, Number(sleepArg.split('=')[1])||400) : 400;
  const neOnly = argv.includes('--ne-only');
  const targets = argv.filter(a=>/^[A-Z]{3}$/.test(a));
  const list = targets.length ? targets : getCountryList();
  const minBytes = minBytesArg ? Math.max(1, Number(minBytesArg.split('=')[1])||1024) : 1024;
  console.log(`Fetching major cities for ${list.length} countries... (limit=${limit}, minPop=${minPop})${force?' (force overwrite)':' (skip existing)'} `);
  for(const iso3 of list){
    try{
      // Skip if an existing file likely complete (>= limit features) or at least minBytes
      if(!force){
        try{
          const file = path.join(DATA_DIR, iso3, 'cities.geojson');
          if(fs.existsSync(file)){
            const st = fs.statSync(file);
            if(st && st.isFile() && st.size >= minBytes){
              try{
                const existing = JSON.parse(fs.readFileSync(file,'utf8'));
                const count = Array.isArray(existing?.features) ? existing.features.length : 0;
                if(count >= Math.min(limit, 20)){
                  console.log(`  ${iso3}: exists (${count} features, ${st.size} bytes) — skipping. Use --force to overwrite.`);
                  await sleep(waitMs);
                  continue;
                }
              }catch{
                // If parse fails but file is sizable, still skip unless forced
                console.log(`  ${iso3}: existing file (~${st.size} bytes) — skipping. Use --force to overwrite.`);
                await sleep(waitMs);
                continue;
              }
            }
          }
        }catch{}
      }
      let feats = await fetchCitiesForISO3(iso3, limit, minPop, { neOnly });
      if(feats.length < limit){
        try{
          const outlinePath = getOutlinePath(iso3);
          if(fs.existsSync(outlinePath)){
            const bbox = geojsonBbox(JSON.parse(fs.readFileSync(outlinePath,'utf8')));
            const need = limit - feats.length;
            const osmFeats = await fetchOverpassCities(bbox, need*2);
            // Add until fill to limit
            for(const f of osmFeats){ if(feats.length>=limit) break; if(f && f.properties && f.geometry) feats.push(f); }
          } else {
            // Fallback bbox from Natural Earth admin countries
            try{
              if(!fs.existsSync(NE_ADMIN_CACHE)){
                const r = await fetch(NE_ADMIN_URL);
                if(r.ok){ const buf = await r.arrayBuffer(); fs.writeFileSync(NE_ADMIN_CACHE, Buffer.from(buf)); }
              }
              if(fs.existsSync(NE_ADMIN_CACHE)){
                const admin = JSON.parse(fs.readFileSync(NE_ADMIN_CACHE,'utf8'));
                const rows = Array.isArray(admin?.features) ? admin.features : [];
                const match = rows.find(f => {
                  const p = f && f.properties ? f.properties : null; if(!p) return false;
                  const candidates = [p.ADM0_A3, p.ISO_A3, p.SOV_A3, p.ADM0_A3_US, p.ADM0_A3_UN];
                  return candidates.some(v => typeof v === 'string' && v.toUpperCase() === iso3);
                });
                if(match && match.geometry){
                  const bbox = geojsonBbox(match);
                  const need = limit - feats.length;
                  const osmFeats = await fetchOverpassCities(bbox, need*2);
                  for(const f of osmFeats){ if(feats.length>=limit) break; if(f && f.properties && f.geometry) feats.push(f); }
                }
              }
            }catch{}
          }
        }catch(err){ /* ignore */ }
      }
      const file = await writeCountryCities(iso3, feats);
      console.log(`  ${iso3}: wrote ${feats.length} cities to ${file}`);
    }catch(err){
      console.error(`  ${iso3}: failed:`, err && err.message || err);
    }
    await sleep(waitMs);
  }
  console.log('Done');
}

main().catch(e=>{ console.error('FATAL', e && e.message || e); process.exit(1); });
