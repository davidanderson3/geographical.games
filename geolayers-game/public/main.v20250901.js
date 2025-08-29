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
let map;
let outline;
let citiesLayer;

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
const layerMode = (urlParams.get('layers')||'all').toLowerCase();

fetch('countries.json').then(r=>r.json()).then(data=>{
  data.sort((a,b)=>a.name.localeCompare(b.name));
  for (const c of data) {
    const opt = document.createElement('option');
    opt.value = c.code;
    opt.textContent = c.name;
    guess.appendChild(opt);
  }
  const locations = data.map(c=>c.code);
  if (forcedCountry && locations.includes(forcedCountry)) {
    locationId = forcedCountry;
  } else {
    locationId = pickLocation(locations);
  }
  try { console.log('GeoLayers selected location', locationId); } catch {}
  loadCountry();
});

function loadCountry() {
  try { console.log('GeoLayers loading', locationId); } catch {}
  Promise.all([
    fetch(`data/${locationId}/outline.geojson`).then(r => r.ok ? r.json() : { type:'FeatureCollection', features: [] }).catch(() => ({ type:'FeatureCollection', features: [] })),
    (async () => {
      try {
        const r1 = await fetch(`data/${locationId}/rivers_highres.geojson`);
        if (r1.ok) return r1.json();
      } catch {}
      try {
        const r2 = await fetch(`data/${locationId}/rivers.geojson`);
        if (r2.ok) return r2.json();
      } catch {}
      return { type:'FeatureCollection', features: [] };
    })()
  ]).then(([outlineGeo, riversGeo]) => {
    if (!map) {
      // Initialize with a safe default view so resize/getCenter never sees undefined zoom
      map = L.map('map', { zoomControl: false, attributionControl: false, center: [20, 0], zoom: 2 });
      try { map.on('resize', (ev) => { try { console.log('Map resize event, zoom=', map.getZoom()); } catch {} }); } catch {}
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
      riversLayer = L.geoJSON(riversSan, { style: { color: '#0ff' }, coordsToLatLng: safeCoordsToLatLng });
    } catch {
      riversLayer = L.geoJSON({ type:'FeatureCollection', features: [] });
    }

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
      // Add layers after view set
      if (layerMode === 'outline') {
        outline.addTo(map);
      } else if (layerMode === 'rivers') {
        riversLayer.addTo(map);
      } else {
        outline.addTo(map);
        riversLayer.addTo(map);
      }
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
          L.circleMarker(latlng, { radius: 5, color: '#f00' }).bindTooltip((feature && feature.properties && feature.properties.name) || '')
      });
      citiesLayer.addTo(map);
    } catch {}
  }).catch(() => {});
}

guess.addEventListener('change', () => {
  if (finished) return;
  const val = guess.value;
  if (!val) return;
  if (val === locationId) {
    document.getElementById('score').textContent = `Correct! It is ${val}.`;
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
});
