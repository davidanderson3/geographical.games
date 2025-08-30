let locationId = '';
const GEO_MAIN_VERSION = '20250901';
try { console.log('GeoLayers main.js version', GEO_MAIN_VERSION); } catch {}

// Last-resort safety: wrap Leaflet's latLng and default GeoJSON converter
try {
  if (window.L) {
    const __origLatLngFactory = L.latLng.bind(L);
    L.latLng = function(...args) {
      try {
        const ll = __origLatLngFactory(...args);
        if (!Number.isFinite(ll.lat) || !Number.isFinite(ll.lng)) {
          return __origLatLngFactory(0, 0);
        }
        return ll;
      } catch (e) {
        try { console.warn('latLng guarded fallback', e && e.message); } catch {}
        return __origLatLngFactory(0, 0);
      }
    };
    if (L.GeoJSON) {
      L.GeoJSON.coordsToLatLng = function(coords) {
        const lng = Number(Array.isArray(coords) ? coords[0] : undefined);
        const lat = Number(Array.isArray(coords) ? coords[1] : undefined);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          try { console.warn('coordsToLatLng guarded fallback for coords', coords); } catch {}
          return L.latLng(0, 0);
        }
        return L.latLng(lat, lng);
      };
    }
  }
} catch {}

// Global error hook to surface any remaining NaN traces
try {
  window.addEventListener('error', (e) => {
    try { console.error('GeoLayers window error:', e && (e.message || e.error)); } catch {}
  });
} catch {}

let finished = false;
const guess = document.getElementById('guess');
const countriesList = document.getElementById('countriesList');
let map;
let outline;
let citiesLayer;
let riversLayer;
let roadsLayer;
let topoLayer;
let round = 1;
const MAX_ROUNDS = 4;
const guessedSet = new Set(); // solved/revealed across rotations
let triedSet = new Set();     // guesses for current country
let rotateTimer = null;
let rotateTimeout = null;
const nameByCode = {};        // code -> display name
let currentAbort = null;      // abort controller for in-flight fetches

function isFiniteNum(n){ return typeof n === 'number' && isFinite(n); }
function coordValid(c){ return Array.isArray(c) && isFiniteNum(c[0]) && isFiniteNum(c[1]); }
function safeCoordsToLatLng(coords){
  const lng = Number(Array.isArray(coords) ? coords[0] : undefined);
  const lat = Number(Array.isArray(coords) ? coords[1] : undefined);
  if (!isFinite(lng) || !isFinite(lat)) {
    return L.latLng(0, 0);
  }
  return L.latLng(lat, lng);
}

function formatCityName(name){
  let n = String(name||'').trim();
  if(!n) return n;
  // Strip generic descriptor suffixes regardless of case (data often appends these)
  const suffixes = [
    'city municipality',
    'town municipality',
    'city', 'town', 'village', 'municipality', 'borough', 'commune'
  ];
  let changed = true;
  while(changed){
    changed = false;
    for(const suf of suffixes){
      const re = new RegExp('\\s+' + suf.replace(/\s+/g,'\\s+') + '\\.?$', 'i');
      if(re.test(n)){
        n = n.replace(re,'').trim();
        changed = true;
        break;
      }
    }
  }
  return n;
}

function capFeatureCount(gj, max=30000){
  try{
    if(!gj || gj.type!=='FeatureCollection') return gj;
    const feats = Array.isArray(gj.features)?gj.features:[];
    if(feats.length <= max) return gj;
    return { type:'FeatureCollection', features: feats.slice(0, max) };
  }catch{ return gj; }
}

function pruneGeometry(geom){
  if(!geom || !geom.type) return null;
  const t = geom.type;
  const c = geom.coordinates;
  if(t === 'Point') return coordValid(c) ? geom : null;
  if(t === 'MultiPoint'){
    const pts = Array.isArray(c) ? c.filter(coordValid) : [];
    return pts.length ? { type:'MultiPoint', coordinates: pts } : null;
  }
  if(t === 'LineString'){
    const ls = Array.isArray(c) ? c.filter(coordValid) : [];
    return ls.length >= 2 ? { type:'LineString', coordinates: ls } : null;
  }
  if(t === 'MultiLineString'){
    const mls = (Array.isArray(c) ? c : []).map(ls=> (Array.isArray(ls)? ls.filter(coordValid):[])).filter(ls=> ls.length>=2);
    return mls.length ? { type:'MultiLineString', coordinates: mls } : null;
  }
  if(t === 'Polygon'){
    const poly = (Array.isArray(c) ? c : []).map(ring=> (Array.isArray(ring)? ring.filter(coordValid):[])).filter(ring=> ring.length>=4);
    return poly.length ? { type:'Polygon', coordinates: poly } : null;
  }
  if(t === 'MultiPolygon'){
    const mp = (Array.isArray(c) ? c : [])
      .map(poly => (Array.isArray(poly)? poly.map(ring=> (Array.isArray(ring)? ring.filter(coordValid):[])).filter(r=> r.length>=4):[]))
      .filter(poly => poly.length);
    return mp.length ? { type:'MultiPolygon', coordinates: mp } : null;
  }
  if(t === 'GeometryCollection'){
    const geoms = (Array.isArray(geom.geometries) ? geom.geometries : []).map(pruneGeometry).filter(Boolean);
    return geoms.length ? { type:'GeometryCollection', geometries: geoms } : null;
  }
  return null;
}

function sanitizeGeoJSON(fc){
  if(!fc) return null;
  if(fc.type === 'FeatureCollection'){
    const feats = (fc.features||[]).map(f=>{
      const g = pruneGeometry(f && f.geometry);
      if(!g) return null;
      return { type:'Feature', geometry: g, properties: (f && f.properties) || {} };
    }).filter(Boolean);
    return { type:'FeatureCollection', features: feats };
  }
  if(fc.type === 'Feature'){
    const g = pruneGeometry(fc.geometry);
    return g ? { type:'Feature', geometry: g, properties: fc.properties||{} } : null;
  }
  const g = pruneGeometry(fc);
  return g ? g : null;
}

// Prefer major roads across the entire country instead of early-file bias.
function limitRoads(fc, max=30000){
  try{
    if(!fc || fc.type !== 'FeatureCollection') return fc;
    const feats = Array.isArray(fc.features) ? fc.features : [];
    if(feats.length <= max) return fc;

    const prioOrder = ['motorway','trunk','primary','secondary','tertiary','unclassified','residential','service','track','path','road'];
    const bins = new Map();
    for(const key of prioOrder) bins.set(key, []);
    bins.set('__other__', []);

    for(const f of feats){
      const hw = (f && f.properties && String(f.properties.highway||'').toLowerCase()) || '';
      const key = prioOrder.includes(hw) ? hw : '__other__';
      bins.get(key).push(f);
    }

    const out = [];
    for(const key of prioOrder.concat(['__other__'])){
      if(out.length >= max) break;
      const arr = bins.get(key) || [];
      if(!arr.length) continue;
      const remaining = max - out.length;
      if(arr.length <= remaining){
        out.push(...arr);
      } else {
        // Evenly sample this category to fill remaining slots
        const step = arr.length / remaining;
        for(let i=0;i<remaining;i++){
          const idx = Math.floor(i * step);
          out.push(arr[idx]);
        }
      }
    }
    return { type:'FeatureCollection', features: out };
  }catch{ return fc; }
}

function pickLocation(locations) {
  return locations[Math.floor(Math.random() * locations.length)];
}

const urlParams = new URLSearchParams(location.search);
const forcedCountry = urlParams.get('country');
const adminMode = /^(1|true|yes)$/i.test(String(urlParams.get('admin')||''));
const layerMode = (urlParams.get('layers')||'rivers').toLowerCase();
const adminLayers = String(urlParams.get('layers')||'rivers').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);

fetch('countries.json').then(r=>r.json()).then(data=>{
  data.sort((a,b)=>a.name.localeCompare(b.name));
  const codeByName = new Map();
  const codeSet = new Set();
  for (const c of data) {
    const opt = document.createElement('option');
    opt.value = c.name;
    if (countriesList) countriesList.appendChild(opt);
    codeByName.set(c.name.toLowerCase(), c.code);
    codeSet.add(c.code.toLowerCase());
  }
  const locations = data.map(c=>c.code);
  for(const c of data){ nameByCode[c.code] = c.name; }
  window.__countryCodes = locations.slice();
  if (forcedCountry && locations.includes(forcedCountry)) {
    locationId = forcedCountry;
  } else {
    locationId = pickLocation(locations);
  }
  try { console.log('GeoLayers selected location', locationId); } catch {}
  loadCountry();
  if(!adminMode) scheduleRotation();

  function normalizeGuess(v){ return String(v||'').trim().toLowerCase(); }
  function resolveGuess(val){
    const n = normalizeGuess(val);
    if (!n) return '';
    if (codeSet.has(n)) return n.toUpperCase();
    if (codeByName.has(n)) return codeByName.get(n);
    return '';
  }
  function handleGuess(){
    if (adminMode) return; // disable guessing in admin view
    if (finished) return;
    const typed = guess.value;
    const code = resolveGuess(typed);
    try { guess.value = ''; } catch {}
    if (!code) return;
    if (code === locationId) {
      document.getElementById('score').textContent = `Correct! It is ${code}.`;
      finished = true;
      guessedSet.add(code);
      updateGuessedUI();
      outline.addTo(map);
      const b = outline.getBounds();
      if (b && b.isValid && b.isValid()) {
        map.fitBounds(b.pad(0.1));
      }
    } else {
      triedSet.add(code);
      if (round < MAX_ROUNDS) {
        round += 1;
        applyRoundLayers();
        document.getElementById('score').textContent = `Round ${round}/${MAX_ROUNDS} — keep guessing!`;
        updateGuessedUI();
      } else {
        document.getElementById('score').textContent = `Out of rounds. It was ${nameByCode[locationId] || locationId}.`;
        finished = true;
        guessedSet.add(locationId);
        updateGuessedUI();
        outline.addTo(map);
      }
    }
  }
  guess.addEventListener('change', handleGuess);
  guess.addEventListener('keydown', (e)=>{ if(e.key==='Enter') handleGuess(); });
});

function updateGuessedUI(){
  try{
    const el = document.getElementById('guessed');
    if(!el) return;
    const parts = [];
    if(triedSet.size>0){
      parts.push('Tried: ' + Array.from(triedSet).map(c=> nameByCode[c]||c).join(', '));
    }
    if(guessedSet.size>0){
      parts.push('Solved: ' + Array.from(guessedSet).map(c=> nameByCode[c]||c).join(', '));
    }
    el.textContent = parts.join('  •  ');
  }catch{}
}

function applyRoundLayers(){
  if(!map) return;
  try{
    const layers = [riversLayer, citiesLayer, topoLayer, roadsLayer, outline];
    for(const l of layers){ if(l && map.hasLayer(l)) map.removeLayer(l); }
  }catch{}
  if(riversLayer) riversLayer.addTo(map);
  if(round>=2 && citiesLayer) citiesLayer.addTo(map);
  if(round>=3 && topoLayer) topoLayer.addTo(map);
  if(round>=4 && roadsLayer) roadsLayer.addTo(map);
  if(round>=4 && outline) outline.addTo(map);
}

function applyAdminLayers(){
  if(!map) return;
  try{
    const layersAll = [riversLayer, citiesLayer, topoLayer, roadsLayer, outline];
    for(const l of layersAll){ if(l && map.hasLayer(l)) map.removeLayer(l); }
  }catch{}
  const set = new Set(adminLayers);
  if(set.has('all')){ set.clear(); ['rivers','cities','topo','roads','outline'].forEach(x=>set.add(x)); }
  if(set.has('rivers') && riversLayer) riversLayer.addTo(map);
  if(set.has('cities') && citiesLayer) citiesLayer.addTo(map);
  if(set.has('topo') && topoLayer) topoLayer.addTo(map);
  if(set.has('roads') && roadsLayer) roadsLayer.addTo(map);
  if(set.has('outline') && outline) outline.addTo(map);
}

function rotateCountry(){
  if(!window.__countryCodes || !window.__countryCodes.length) return;
  const list = window.__countryCodes;
  let next = locationId;
  for(let i=0;i<10;i++){
    const cand = list[Math.floor(Math.random()*list.length)];
    if(cand!==locationId){ next=cand; break; }
  }
  locationId = next;
  finished = false;
  round = 1;
  triedSet = new Set();
  document.getElementById('score').textContent = '';
  updateGuessedUI();
  try { guess.value = ''; } catch {}
  loadCountry();
}

function scheduleRotation(){
  try{ if(rotateTimer) clearInterval(rotateTimer); }catch{}
  try{ if(rotateTimeout) clearTimeout(rotateTimeout); }catch{}
  rotateTimeout = setTimeout(rotateCountry, 5*60*1000); // 5 minutes
}

function loadCountry() {
  try { console.log('GeoLayers loading', locationId); } catch {}
  // Cancel any in-flight loads from the previous country
  try { if (currentAbort) currentAbort.abort(); } catch {}
  currentAbort = new AbortController();
  const signal = currentAbort.signal;

  // Remove existing layers explicitly to free memory
  try { if (riversLayer && map && map.hasLayer(riversLayer)) map.removeLayer(riversLayer); } catch {}
  try { if (citiesLayer && map && map.hasLayer(citiesLayer)) map.removeLayer(citiesLayer); } catch {}
  try { if (roadsLayer  && map && map.hasLayer(roadsLayer))  map.removeLayer(roadsLayer); } catch {}
  try { if (topoLayer   && map && map.hasLayer(topoLayer))   map.removeLayer(topoLayer); } catch {}
  try { if (outline     && map && map.hasLayer(outline))     map.removeLayer(outline); } catch {}
  riversLayer = citiesLayer = roadsLayer = topoLayer = null;

  Promise.all([
    fetch(`data/${locationId}/outline.geojson`, { signal }).then(r => r.ok ? r.json() : { type:'FeatureCollection', features: [] }).catch(() => ({ type:'FeatureCollection', features: [] })),
    (async () => {
      try {
        const r1 = await fetch(`data/${locationId}/rivers_highres.geojson`, { signal });
        if (r1.ok) return r1.json();
      } catch {}
      try {
        const r2 = await fetch(`data/${locationId}/rivers.geojson`, { signal });
        if (r2.ok) return r2.json();
      } catch {}
      return { type:'FeatureCollection', features: [] };
    })(),
    (async () => {
      try {
        const r1 = await fetch(`data/${locationId}/roads.geojson`, { signal });
        if (r1.ok) return r1.json();
      } catch {}
      return { type:'FeatureCollection', features: [] };
    })(),
    (async () => {
      try {
        const r1 = await fetch(`data/${locationId}/elevation.geojson`, { signal });
        if (r1.ok) return r1.json();
      } catch {}
      return { type:'FeatureCollection', features: [] };
    })(),
    (async () => {
      try {
        const r1 = await fetch(`data/${locationId}/cities.geojson`, { signal });
        if (r1.ok) return r1.json();
      } catch {}
      return { type:'FeatureCollection', features: [] };
    })()
  ]).then(([outlineGeo, riversGeo, roadsGeo, elevationGeo, citiesGeo]) => {
    if (!map) {
      // Initialize with a safe default view so resize/getCenter never sees undefined zoom
      map = L.map('map', { zoomControl: false, attributionControl: false, center: [20, 0], zoom: 2, preferCanvas: true });
      try { map.on('resize', (ev) => { try { console.log('Map resize event, zoom=', map.getZoom()); } catch {} }); } catch {}
    } else {
      // Do not remove baselayers; we already removed our vector layers above
    }

    citiesLayer = null;

    const outlineSan = sanitizeGeoJSON(outlineGeo) || outlineGeo;
    const riversSan = capFeatureCount(sanitizeGeoJSON(riversGeo) || riversGeo, 40000);
    try {
      outline = L.geoJSON(outlineSan, { coordsToLatLng: safeCoordsToLatLng });
    } catch {
      outline = L.geoJSON({ type:'FeatureCollection', features: [] });
    }
    try {
      riversLayer = L.geoJSON(riversSan, { style: { color: '#0ff', weight: 1, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }, coordsToLatLng: safeCoordsToLatLng });
    } catch {
      riversLayer = L.geoJSON({ type:'FeatureCollection', features: [] });
    }
    try {
      const roadsSan0 = sanitizeGeoJSON(roadsGeo) || roadsGeo;
      const roadsSan = limitRoads(roadsSan0, 30000);
      roadsLayer = L.geoJSON(roadsSan, { style: { color: '#888', weight: 1, opacity: 0.7, lineCap: 'round', lineJoin: 'round' }, coordsToLatLng: safeCoordsToLatLng });
    } catch { roadsLayer = null; }
    try {
      const topoSan = capFeatureCount(sanitizeGeoJSON(elevationGeo) || elevationGeo, 30000);
      topoLayer = L.geoJSON(topoSan, { style: { color: '#aaa', weight: 0.8, opacity: 0.6, dashArray: '2,2', lineCap: 'round', lineJoin: 'round' }, coordsToLatLng: safeCoordsToLatLng });
    } catch { topoLayer = null; }
    try {
      const citiesSan = sanitizeGeoJSON(citiesGeo) || citiesGeo;
      citiesLayer = L.geoJSON(citiesSan, {
        coordsToLatLng: safeCoordsToLatLng,
        pointToLayer: (feature, latlng) =>
          L.circleMarker(latlng, { radius: 5, color: '#f00' }).bindTooltip((feature && feature.properties && feature.properties.name) || '')
      });
    } catch { citiesLayer = null; }

    // Defer fitBounds until container has real size to avoid Infinity zoom
    const ensureSized = () => {
      try {
        const el = map.getContainer();
        if (!el) return false;
        const w = el.clientWidth|0, h = el.clientHeight|0;
        return w > 0 && h > 0;
      } catch { return false; }
    };
    const applyView = () => {
      const bounds = outline.getBounds();
      if (bounds && bounds.isValid && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [20, 20] });
      } else {
        map.setView([20, 0], 2);
      }
      if(adminMode) applyAdminLayers(); else applyRoundLayers();
    };
    if (ensureSized()) {
      applyView();
    } else {
      let tries = 0;
      const t = setInterval(() => {
        if (ensureSized() || tries++ > 40) { // up to ~2s
          clearInterval(t);
          applyView();
        }
      }, 50);
    }
  }).catch(() => {
    if (!map) {
      map = L.map('map', { zoomControl: false, attributionControl: false, center: [20, 0], zoom: 2, preferCanvas: true });
    }
    map.setView([20, 0], 2);
  });
}

// Clear timers and aborts on unload to avoid background work
try{
  window.addEventListener('beforeunload', () => {
    try { if (rotateTimer) clearInterval(rotateTimer); } catch {}
    try { if (rotateTimeout) clearTimeout(rotateTimeout); } catch {}
    try { if (currentAbort) currentAbort.abort(); } catch {}
  });
}catch{}

function showCities() {
  if (citiesLayer) {
    citiesLayer.addTo(map);
    return;
  }
  fetch(`data/${locationId}/cities.geojson`).then(r => {
    if (!r.ok) return null;
    return r.json();
  }).then(citiesGeo => {
    if (!citiesGeo) return;
      const citiesSan = sanitizeGeoJSON(citiesGeo) || citiesGeo;
      try {
        citiesLayer = L.geoJSON(citiesSan, {
          coordsToLatLng: safeCoordsToLatLng,
          pointToLayer: (feature, latlng) =>
          L.circleMarker(latlng, { radius: 5, color: '#f00' }).bindTooltip(formatCityName((feature && feature.properties && feature.properties.name) || ''))
        });
        citiesLayer.addTo(map);
      } catch {}
  }).catch(() => {});
}
