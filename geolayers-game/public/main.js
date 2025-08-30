let locationId = '';
const GEO_MAIN_VERSION = '20250829-2';
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
let finished = false;
const guess = document.getElementById('guess');
const countriesList = document.getElementById('countriesList');
let map;
let outline;
let citiesLayer;

function isFiniteNum(n){ return typeof n === 'number' && isFinite(n); }
function coordValid(c){ return Array.isArray(c) && isFiniteNum(c[0]) && isFiniteNum(c[1]); }
function safeCoordsToLatLng(coords){
  const lng = Number(Array.isArray(coords) ? coords[0] : undefined);
  const lat = Number(Array.isArray(coords) ? coords[1] : undefined);
  if (!isFinite(lng) || !isFinite(lat)) {
    // Fallback to a harmless coordinate; better than throwing and breaking render
    return L.latLng(0, 0);
  }
  return L.latLng(lat, lng);
}

function formatCityName(name){
  let n = String(name||'').trim();
  if(!n) return n;
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

function pickLocation(locations) {
  return locations[Math.floor(Math.random() * locations.length)];
}

const urlParams = new URLSearchParams(location.search);
const forcedCountry = urlParams.get('country');
const layerMode = (urlParams.get('layers')||'rivers').toLowerCase();

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
  if (forcedCountry && locations.includes(forcedCountry)) {
    locationId = forcedCountry;
  } else {
    locationId = pickLocation(locations);
  }
  try { console.log('GeoLayers selected location', locationId); } catch {}
  loadCountry();

  function normalizeGuess(v){ return String(v||'').trim().toLowerCase(); }
  function resolveGuess(val){
    const n = normalizeGuess(val);
    if (!n) return '';
    if (codeSet.has(n)) return n.toUpperCase();
    if (codeByName.has(n)) return codeByName.get(n);
    return '';
  }
  function handleGuess(){
    if (finished) return;
    const typed = guess.value;
    const code = resolveGuess(typed);
    try { guess.value = ''; } catch {}
    if (!code) return;
    if (code === locationId) {
      document.getElementById('score').textContent = `Correct! It is ${code}.`;
      finished = true;
      outline.addTo(map);
      const b = outline.getBounds();
      if (b && b.isValid && b.isValid()) {
        map.fitBounds(b.pad(0.1));
      }
    } else {
      document.getElementById('score').textContent = 'Incorrect, try again!';
      showCities();
    }
  }
  guess.addEventListener('change', handleGuess);
  guess.addEventListener('keydown', (e)=>{ if(e.key==='Enter') handleGuess(); });
});

function loadCountry() {
  try { console.log('GeoLayers loading', locationId); } catch {}
  Promise.all([
    fetch(`data/${locationId}/outline.geojson`).then(r => r.ok ? r.json() : { type:'FeatureCollection', features: [] }).catch(() => ({ type:'FeatureCollection', features: [] })),
    fetch(`data/${locationId}/rivers.geojson`).then(r => r.ok ? r.json() : { type:'FeatureCollection', features: [] }).catch(() => ({ type:'FeatureCollection', features: [] }))
  ]).then(([outlineGeo, riversGeo]) => {
    if (!map) {
      map = L.map('map', { zoomControl: false, attributionControl: false, center: [20, 0], zoom: 2 });
    } else {
      map.eachLayer(l => map.removeLayer(l));
    }

    citiesLayer = null;

    const outlineSan = sanitizeGeoJSON(outlineGeo) || outlineGeo;
    const riversSan = sanitizeGeoJSON(riversGeo) || riversGeo;
    try {
      outline = L.geoJSON(outlineSan, { coordsToLatLng: safeCoordsToLatLng });
    } catch {
      outline = L.geoJSON({ type:'FeatureCollection', features: [] });
    }
    let riversLayer;
    try {
      riversLayer = L.geoJSON(riversSan, { style: { color: '#0ff', weight: 1, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }, coordsToLatLng: safeCoordsToLatLng });
    } catch {
      riversLayer = L.geoJSON({ type:'FeatureCollection', features: [] });
    }

    // Fit the map view to the country's outline dimensions with a small padding
    const bounds = outline.getBounds();
    if (bounds && bounds.isValid && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [20, 20] });
    } else {
      map.setView([20, 0], 2);
    }

    // Add layers: default to rivers only; outline only when requested
    if (layerMode === 'outline') {
      outline.addTo(map);
    } else {
      riversLayer.addTo(map);
    }
  }).catch(() => {
    if (!map) {
      map = L.map('map', { zoomControl: false, attributionControl: false, center: [20, 0], zoom: 2 });
    }
    map.setView([20, 0], 2);
  });
}

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
