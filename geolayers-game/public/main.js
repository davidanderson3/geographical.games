let locationId = '';
let finished = false;
const guess = document.getElementById('guess');
let map;
let outline;
let citiesLayer;

function pickLocation(locations) {
  return locations[Math.floor(Math.random() * locations.length)];
}

fetch('countries.json').then(r=>r.json()).then(data=>{
  data.sort((a,b)=>a.name.localeCompare(b.name));
  for (const c of data) {
    const opt = document.createElement('option');
    opt.value = c.code;
    opt.textContent = c.name;
    guess.appendChild(opt);
  }
  const locations = data.map(c=>c.code);
  locationId = pickLocation(locations);
  loadCountry();
});

function loadCountry() {
  Promise.all([
    fetch(`data/${locationId}/outline.geojson`).then(r => r.json()),
    fetch(`data/${locationId}/rivers.geojson`).then(r => r.json())
  ]).then(([outlineGeo, riversGeo]) => {
    if (!map) {
      map = L.map('map', { zoomControl: false, attributionControl: false });
    } else {
      map.eachLayer(l => map.removeLayer(l));
    }

    citiesLayer = null;

    outline = L.geoJSON(outlineGeo);
    const riversLayer = L.geoJSON(riversGeo, { style: { color: '#0ff' } });

    // Use the outline to determine map bounds and start the map zoomed in
    const bounds = outline.getBounds();
    map.fitBounds(bounds);
    if (map.getZoom() < 6) {
      map.setZoom(6);
    }

    riversLayer.addTo(map);
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
    citiesLayer = L.geoJSON(citiesGeo, {
      pointToLayer: (feature, latlng) =>
        L.circleMarker(latlng, { radius: 5, color: '#f00' }).bindTooltip(feature.properties.name)
    });
    citiesLayer.addTo(map);
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
    map.fitBounds(outline.getBounds().pad(0.1));
  } else {
    document.getElementById('score').textContent = 'Incorrect, try again!';
    showCities();
  }
});
