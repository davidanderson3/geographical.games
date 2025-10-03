const express = require('express');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const util = require('util');
let Configuration;
let PlaidApi;
let PlaidEnvironments;
const cors = require('cors');
let nodemailer;
let MBTiles;
let admin;
try {
  ({ Configuration, PlaidApi, PlaidEnvironments } = require('plaid'));
} catch {
  Configuration = null;
  PlaidApi = null;
  PlaidEnvironments = null;
}
try {
  nodemailer = require('nodemailer');
} catch {
  nodemailer = null;
}
try {
  MBTiles = require('@mapbox/mbtiles');
} catch {
  MBTiles = null;
}
try {
  admin = require('firebase-admin');
} catch {
  admin = null;
}

const { loadFirebaseServiceAccount } = require('./loadFirebaseServiceAccount');

const execFileAsync = util.promisify(execFile);
const app = express();
const DEFAULT_PORT = Number(process.env.PORT || 3002);

// Enable CORS for all routes so the frontend can reach the API
app.use(cors());
app.use(compression());

// Load vector tile set if available
const tilePath = path.join(__dirname, '../tiles/geodata.mbtiles');
let mbtiles = null;
if (MBTiles && fs.existsSync(tilePath)) {
  new MBTiles(tilePath, (err, mb) => {
    if (err) {
      console.error('Failed to open MBTiles', err);
    } else {
      mbtiles = mb;
    }
  });
} else if (!MBTiles) {
  console.warn('MBTiles module not available; tile service disabled');
} else {
  console.warn('MBTiles not found; run "npm run generate:tiles"');
}

const CONTACT_EMAIL = Buffer.from('ZHZkbmRyc25AZ21haWwuY29t', 'base64').toString('utf8');
const mailer = (() => {
  if (!nodemailer || !process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
})();

app.use(express.json());

const plaidClient = (() => {
  if (!Configuration || !PlaidApi || !PlaidEnvironments) return null;
  const clientID = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const env = process.env.PLAID_ENV || 'sandbox';
  if (!clientID || !secret) return null;
  const config = new Configuration({
    basePath: PlaidEnvironments[env],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': clientID,
        'PLAID-SECRET': secret
      }
    }
  });
  return new PlaidApi(config);
})();

// Serve static files (like index.html, style.css, script.js)
app.use(express.static(path.resolve(__dirname, '../'), {
  setHeaders: (res, p) => {
    // Strong caching for static assets and large GeoJSONs; versioned URLs bust cache
    if (/\.(?:geojson|json|js|css|png|jpe?g|svg|ico|woff2?)$/i.test(p)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=600');
    }
  }
}));

// Serve vector tiles from MBTiles
app.get('/tiles/:z/:x/:y.pbf', (req, res) => {
  if (!mbtiles) return res.status(503).send('tile service unavailable');
  const { z, x, y } = req.params;
  mbtiles.getTile(+z, +x, +y, (err, data) => {
    if (err || !data) return res.status(404).send('Tile not found');
    res.setHeader('Content-Type', 'application/x-protobuf');
    res.setHeader('Content-Encoding', 'gzip');
    res.send(data);
  });
});

app.post('/contact', async (req, res) => {
  const { name, from, message } = req.body || {};
  if (!from || !message) {
    return res.status(400).json({ error: 'invalid' });
  }
  if (!mailer) {
    return res.status(500).json({ error: 'mail disabled' });
  }
  try {
    await mailer.sendMail({
      to: CONTACT_EMAIL,
      from: process.env.SMTP_USER,
      replyTo: from,
      subject: `Dashboard contact from ${name || 'Anonymous'}`,
      text: message
    });
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Contact email failed', err);
    res.status(500).json({ error: 'failed' });
  }
});

// --- Description persistence ---
const descFile = path.join(__dirname, 'descriptions.json');

function readDescriptions() {
  try {
    const text = fs.readFileSync(descFile, 'utf8');
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function writeDescriptions(data) {
  fs.writeFileSync(descFile, JSON.stringify(data, null, 2));
}

app.get('/api/descriptions', (req, res) => {
  res.json(readDescriptions());
});

app.post('/api/description', (req, res) => {
  const { panelId, position, text } = req.body || {};
  if (!panelId || !['top', 'bottom'].includes(position) || typeof text !== 'string') {
    return res.status(400).json({ error: 'invalid' });
  }
  const data = readDescriptions();
  data[panelId] = data[panelId] || {};
  data[panelId][position] = text;
  writeDescriptions(data);
  res.json({ status: 'ok' });
});

// --- Saved movies persistence ---
const savedFile = path.join(__dirname, 'saved-movies.json');

function readSavedMovies() {
  try {
    const txt = fs.readFileSync(savedFile, 'utf8');
    return JSON.parse(txt);
  } catch {
    return [];
  }
}

function writeSavedMovies(data) {
  fs.writeFileSync(savedFile, JSON.stringify(data, null, 2));
}

app.get('/api/saved-movies', (req, res) => {
  res.json(readSavedMovies());
});

app.post('/api/saved-movies', (req, res) => {
  const movie = req.body || {};
  if (!movie || !movie.id) {
    return res.status(400).json({ error: 'invalid' });
  }
  const data = readSavedMovies();
  if (!data.some(m => String(m.id) === String(movie.id))) {
    data.push(movie);
    writeSavedMovies(data);
  }
  res.json({ status: 'ok' });
});

// --- Spotify client ID ---
app.get('/api/spotify-client-id', (req, res) => {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: 'missing' });
  }
  res.json({ clientId });
});

// --- Geoscore overrides (persist answer text + weights on disk) ---
const geoscoreOvFile = path.join(__dirname, 'geoscore-overrides.json');
function readGeoscoreOverrides() {
  try {
    const txt = fs.readFileSync(geoscoreOvFile, 'utf8');
    const obj = JSON.parse(txt);
    return (obj && typeof obj === 'object') ? obj : {};
  } catch {
    return {};
  }
}
function writeGeoscoreOverrides(data) {
  const safe = (data && typeof data === 'object') ? data : {};
  fs.writeFileSync(geoscoreOvFile, JSON.stringify(safe, null, 2));
}

app.get('/api/geoscore-overrides', (req, res) => {
  const ov = readGeoscoreOverrides();
  const out = {
    answerOverrides: ov.answerOverrides || {},
    weightOverrides: ov.weightOverrides || {},
    removedAnswers: ov.removedAnswers || {},
    removedQuestions: ov.removedQuestions || {},
    weightByCountry: ov.weightByCountry || {},
    weightByCity: ov.weightByCity || {}
  };
  res.json(out);
});

app.post('/api/geoscore/answer-override', (req, res) => {
  const { questionKey, originalAnswer, newValue } = req.body || {};
  if (typeof questionKey !== 'string' || typeof originalAnswer !== 'string' || typeof newValue !== 'string') {
    return res.status(400).json({ error: 'invalid' });
  }
  const data = readGeoscoreOverrides();
  data.answerOverrides = data.answerOverrides || {};
  data.answerOverrides[questionKey] = data.answerOverrides[questionKey] || {};
  if (newValue) {
    data.answerOverrides[questionKey][originalAnswer] = newValue;
  } else {
    delete data.answerOverrides[questionKey][originalAnswer];
  }
  writeGeoscoreOverrides(data);
  res.json({ status: 'ok' });
});

app.post('/api/geoscore/weight-override', (req, res) => {
  const { questionKey, originalAnswer, weight } = req.body || {};
  const w = Number(weight);
  if (typeof questionKey !== 'string' || typeof originalAnswer !== 'string' || !Number.isFinite(w)) {
    return res.status(400).json({ error: 'invalid' });
  }
  const clamped = Math.max(0, Math.min(100, Math.round(w)));
  const data = readGeoscoreOverrides();
  data.weightOverrides = data.weightOverrides || {};
  data.weightOverrides[questionKey] = data.weightOverrides[questionKey] || {};
  data.weightOverrides[questionKey][originalAnswer] = clamped;
  writeGeoscoreOverrides(data);
  res.json({ status: 'ok', weight: clamped });
});

app.post('/api/geoscore/weight-country', (req, res) => {
  const { name, weight } = req.body || {};
  const w = Number(weight);
  if (typeof name !== 'string' || !Number.isFinite(w)) {
    return res.status(400).json({ error: 'invalid' });
  }
  const clamped = Math.max(0, Math.min(100, Math.round(w)));
  const data = readGeoscoreOverrides();
  data.weightByCountry = data.weightByCountry || {};
  data.weightByCountry[name] = clamped;
  writeGeoscoreOverrides(data);
  res.json({ status: 'ok' });
});

app.post('/api/geoscore/weight-city', (req, res) => {
  const { name, weight } = req.body || {};
  const w = Number(weight);
  if (typeof name !== 'string' || !Number.isFinite(w)) {
    return res.status(400).json({ error: 'invalid' });
  }
  const clamped = Math.max(0, Math.min(100, Math.round(w)));
  const data = readGeoscoreOverrides();
  data.weightByCity = data.weightByCity || {};
  data.weightByCity[name] = clamped;
  writeGeoscoreOverrides(data);
  res.json({ status: 'ok' });
});

app.post('/api/geoscore/remove-answer', (req, res) => {
  const { questionKey, originalAnswer } = req.body || {};
  if (typeof questionKey !== 'string' || typeof originalAnswer !== 'string') {
    return res.status(400).json({ error: 'invalid' });
  }
  const data = readGeoscoreOverrides();
  data.removedAnswers = data.removedAnswers || {};
  data.removedAnswers[questionKey] = data.removedAnswers[questionKey] || {};
  data.removedAnswers[questionKey][originalAnswer] = true;
  writeGeoscoreOverrides(data);
  res.json({ status: 'ok' });
});

app.post('/api/geoscore/restore-answer', (req, res) => {
  const { questionKey, originalAnswer } = req.body || {};
  if (typeof questionKey !== 'string' || typeof originalAnswer !== 'string') {
    return res.status(400).json({ error: 'invalid' });
  }
  const data = readGeoscoreOverrides();
  if (data.removedAnswers && data.removedAnswers[questionKey]) {
    delete data.removedAnswers[questionKey][originalAnswer];
    if (Object.keys(data.removedAnswers[questionKey]).length === 0) {
      delete data.removedAnswers[questionKey];
    }
  }
  writeGeoscoreOverrides(data);
  res.json({ status: 'ok' });
});

// Remove a question entirely by its exact question text
app.post('/api/geoscore/remove-question', (req, res) => {
  const { questionKey } = req.body || {};
  if (typeof questionKey !== 'string' || !questionKey.trim()) {
    return res.status(400).json({ error: 'invalid' });
  }
  const data = readGeoscoreOverrides();
  data.removedQuestions = data.removedQuestions || {};
  data.removedQuestions[questionKey] = true;
  writeGeoscoreOverrides(data);
  res.json({ status: 'ok' });
});

// Restore a previously removed question
app.post('/api/geoscore/restore-question', (req, res) => {
  const { questionKey } = req.body || {};
  if (typeof questionKey !== 'string' || !questionKey.trim()) {
    return res.status(400).json({ error: 'invalid' });
  }
  const data = readGeoscoreOverrides();
  if (data.removedQuestions) {
    delete data.removedQuestions[questionKey];
  }
  writeGeoscoreOverrides(data);
  res.json({ status: 'ok' });
});

// --- Ticketmaster proxy ---
app.get('/api/ticketmaster', async (req, res) => {
  const { apiKey, keyword } = req.query || {};
  if (!apiKey || !keyword) {
    return res.status(400).json({ error: 'missing' });
  }
  const url =
    `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${encodeURIComponent(
      apiKey
    )}&classificationName=music&keyword=${encodeURIComponent(keyword)}`;
  try {
    const response = await fetch(url);
    const text = await response.text();
    res.type('application/json').send(text);
  } catch (err) {
    console.error('Ticketmaster fetch failed', err);
    res.status(500).json({ error: 'failed' });
  }
});

// --- Spoonacular proxy ---
app.get('/api/spoonacular', async (req, res) => {
  const { query } = req.query || {};
  const apiKey = process.env.SPOONACULAR_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'missing api key' });
  }
  if (!query) {
    return res.status(400).json({ error: 'missing query' });
  }
  const apiUrl =
    `https://api.spoonacular.com/recipes/complexSearch?query=${encodeURIComponent(
      query
    )}&number=50&offset=0&addRecipeInformation=true&apiKey=${apiKey}`;
  try {
    const apiRes = await fetch(apiUrl);
    const data = await apiRes.json();
    res.status(apiRes.status).json(data);
  } catch (err) {
    console.error('Spoonacular fetch failed', err);
    res.status(500).json({ error: 'failed' });
  }
});

// --- GeoLayers game endpoints ---
const layerOrder = ['rivers','lakes','elevation','roads','outline','cities','label'];
const countriesPath = path.join(__dirname, '../geolayers-game/public/countries.json');
let countryData = [];
try {
  countryData = JSON.parse(fs.readFileSync(countriesPath, 'utf8'));
} catch {
  countryData = [];
}
const locations = countryData.map(c => c.code);
const leaderboard = [];
const countryNames = Object.fromEntries(countryData.map(c => [c.code, c.name]));

async function fetchCitiesForCountry(iso3) {
  const endpoint = 'https://query.wikidata.org/sparql';
  const query = `
SELECT ?city ?cityLabel ?population ?coord WHERE {
  ?country wdt:P298 "${iso3}".
  ?city (wdt:P31/wdt:P279*) wd:Q515;
        wdt:P17 ?country;
        wdt:P625 ?coord.
  OPTIONAL { ?city wdt:P1082 ?population. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY DESC(?population)
LIMIT 10`;
  const url = endpoint + '?format=json&query=' + encodeURIComponent(query);
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/sparql-results+json',
      'User-Agent': 'dashboard-app/1.0'
    }
  });
  if (!res.ok) throw new Error('SPARQL query failed');
  const data = await res.json();
  const features = data.results.bindings
    .map(b => {
      const m = /Point\(([-\d\.eE]+)\s+([-\d\.eE]+)\)/.exec(b.coord.value);
      if (!m) return null;
      const lon = Number(m[1]);
      const lat = Number(m[2]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: {
          name: b.cityLabel?.value || '',
          population: b.population ? Number(b.population.value) : null
        }
      };
    })
    .filter(Boolean);
  return { type: 'FeatureCollection', features };
}

async function ensureCitiesForCountry(code) {
  const dir = path.join(__dirname, '../geolayers-game/public/data', code);
  const file = path.join(dir, 'cities.geojson');
  if (!fs.existsSync(file)) {
    const geo = await fetchCitiesForCountry(code);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(geo));
    console.log('Fetched cities for', code);
  }
  return file;
}

async function ensureAllCities() {
  for (const code of locations) {
    try {
      await ensureCitiesForCountry(code);
    } catch (err) {
      console.error('Failed to fetch cities for', code, err);
    }
  }
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  ensureAllCities().catch(err => console.error('City prefetch failed', err));
}

function dailySeed() {
  const today = new Date().toISOString().slice(0,10);
  let seed = 0;
  for (const c of today) {
    seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  }
  return seed;
}

function pickLocation() {
  const seed = dailySeed();
  return locations[seed % locations.length];
}

app.get('/daily', (req, res) => {
  const loc = pickLocation();
  res.json({
    locationId: loc,
    layers: layerOrder.map(l => `/layer/${loc}/${l}`)
  });
});

app.get('/countries', (req, res) => {
  const list = Object.entries(countryNames).map(([code, name]) => ({ code, name }));
  res.json(list);
});

app.get('/layer/:loc/:name', async (req, res) => {
  const { loc, name } = req.params;
  const hiParam = String(req.query.hi || req.query.highres || '').toLowerCase();
  const wantHi = hiParam === '1' || hiParam === 'true' || hiParam === 'yes';
  const baseDir = path.join(__dirname, '../geolayers-game/public/data', loc);
  let file = path.join(baseDir, `${name}.geojson`);
  if (name === 'rivers') {
    // Prefer standard-resolution rivers by default. Only serve high-res when explicitly requested.
    const hi = path.join(baseDir, 'rivers_highres.geojson');
    if (wantHi && fs.existsSync(hi)) file = hi;
  }
  if (name === 'cities' && !fs.existsSync(file)) {
    try {
      await ensureCitiesForCountry(loc);
    } catch (err) {
      console.error('ensureCitiesForCountry failed', err);
    }
  }
  fs.readFile(file, 'utf8', (err, data) => {
    if (err) return res.status(404).send('Layer not found');
    res.type('application/json').send(data);
  });
});

app.post('/score', (req, res) => {
  const { playerName, score } = req.body || {};
  if (typeof playerName === 'string' && typeof score === 'number') {
    leaderboard.push({ playerName, score });
    leaderboard.sort((a, b) => b.score - a.score);
    res.json({ status: 'ok' });
  } else {
    res.status(400).json({ error: 'invalid' });
  }
});

app.get('/leaderboard', (req, res) => {
  res.json(leaderboard.slice(0, 10));
});

app.get('/api/movies', async (req, res) => {
  try {
    const url = 'https://raw.githubusercontent.com/FEND16/movie-json-data/master/json/top-rated-movies-01.json';
    const { stdout } = await execFileAsync('curl', ['-sL', url], { maxBuffer: 5 * 1024 * 1024 });
    const data = JSON.parse(stdout);
    const results = data
      .map(m => ({
        title: m.title,
        score: m.ratings.reduce((a, b) => a + b, 0) / m.ratings.length
      }))
      .slice(0, 10);
    res.json(results);
  } catch (err) {
    console.error('Failed to fetch movies', err);
    res.status(500).json({ error: 'Failed to fetch movies' });
  }
});

app.get('/api/transactions', async (req, res) => {
  if (!plaidClient || !process.env.PLAID_ACCESS_TOKEN) {
    res.status(500).json({ error: 'Plaid not configured' });
    return;
  }
  try {
    const start = new Date();
    start.setMonth(start.getMonth() - 1);
    const end = new Date();
    const response = await plaidClient.transactionsGet({
      access_token: process.env.PLAID_ACCESS_TOKEN,
      start_date: start.toISOString().slice(0, 10),
      end_date: end.toISOString().slice(0, 10)
    });
    res.json(response.data);
  } catch (err) {
    console.error('Plaid error', err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// --- Simple SSE live-reload for static asset changes (dev convenience) ---
const sseClients = new Set();
app.get('/livereload', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();
  res.write(': connected\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

function broadcastReload(reason){
  const msg = `data: reload:${reason || ''}\n\n`;
  for(const res of Array.from(sseClients)){
    try { res.write(msg); } catch { sseClients.delete(res); }
  }
}

function setupWatch(dir){
  try {
    fs.watch(dir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const f = String(filename);
      if (!/\.(html|css|js|json|geojson)$/i.test(f)) return;
      broadcastReload(`${eventType}:${f}`);
    });
    console.log('🔁 Watching for changes in', dir);
  } catch (err) {
    console.warn('fs.watch not supported for', dir, err && err.message);
  }
}

function startServer({ port = DEFAULT_PORT, enableFileWatch = true } = {}) {
  const server = app.listen(port, () => {
    console.log(`✅ Serving static files at http://localhost:${port}`);
  });

  if (enableFileWatch) {
    setupWatch(path.resolve(__dirname, '../'));
    setupWatch(path.resolve(__dirname, '../geolayers-game/public'));
  }

  return server;
}

if (require.main === module) {
  const shouldWatch = process.env.ENABLE_FILE_WATCH !== '0';
  startServer({ enableFileWatch: shouldWatch });
}

// --- Firebase Admin for auth verification (optional) ---
let firebaseAdminReady = false;

function initFirebaseAdmin({ logWarnings = true } = {}) {
  if (!admin || firebaseAdminReady) {
    return firebaseAdminReady;
  }
  try {
    const credJson = loadFirebaseServiceAccount();
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(credJson) });
    }
    firebaseAdminReady = true;
    if (logWarnings) {
      console.log('✅ Firebase Admin initialized for auth verification');
    }
    return true;
  } catch (err) {
    const message = err && err.message ? err.message : 'unknown error';
    if (logWarnings) {
      if (/not found/i.test(message)) {
        console.warn('Firebase service account not found; auth verification disabled');
      } else {
        console.warn('Failed to initialize Firebase Admin:', message);
      }
    }
    return false;
  }
}

initFirebaseAdmin();

app.post('/api/auth/verify', async (req, res) => {
  if (!firebaseAdminReady && !initFirebaseAdmin({ logWarnings: false })) {
    return res.status(503).json({ error: 'auth disabled' });
  }
  const { idToken } = req.body || {};
  if (!idToken) return res.status(400).json({ error: 'missing token' });
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    const user = {
      uid: decoded.uid,
      email: decoded.email || null,
      name: decoded.name || null,
      picture: decoded.picture || null,
      provider: decoded.firebase && decoded.firebase.sign_in_provider || null
    };
    res.json({ user });
  } catch (err) {
    res.status(401).json({ error: 'invalid token' });
  }
});

module.exports = {
  app,
  startServer
};
