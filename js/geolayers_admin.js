async function initGeolayersAdmin(){
  const tabs = document.getElementById('geolayersSubtabs');
  const controls = document.getElementById('geolayersAdminControls');
  const frame = document.getElementById('geolayersFrame');
  if(!tabs || !controls || !frame) return;

  const LS_KEYS = {
    country: 'gl_admin_country',
    layers: 'gl_admin_layers',
    // Stores JSON: { ISO3: ["rivers","cities",...] }
    approveByCountry: 'gl_admin_approve_by_country'
  };

  // Populate countries list
  try{
    const res = await fetch('geolayers-game/public/countries.json');
    const data = await res.json();
    const dl = document.getElementById('glCountries');
    const input = document.getElementById('glCountry');
    const codeByName = new Map();
    const codeSet = new Set();
    data.sort((a,b)=>a.name.localeCompare(b.name));
    for(const c of data){
      const opt = document.createElement('option');
      opt.value = c.name; dl.appendChild(opt);
      codeByName.set(c.name.toLowerCase(), c.code); codeSet.add(c.code.toLowerCase());
    }
    input.dataset._codeMap = JSON.stringify(Object.fromEntries(codeByName));
  }catch{}

  function resolveISO3(val){
    const nameMap = JSON.parse(document.getElementById('glCountry').dataset._codeMap || '{}');
    const n = String(val||'').trim().toLowerCase();
    if(!n) return '';
    if(n.length===3) return n.toUpperCase();
    return nameMap[n] || '';
  }

  function getCurrentISO3(){
    const input = document.getElementById('glCountry');
    const iso = resolveISO3(input.value);
    if(iso) return iso;
    try{ return localStorage.getItem(LS_KEYS.country) || ''; }catch{ return ''; }
  }

  function readApproveMap(){
    try{
      const raw = localStorage.getItem(LS_KEYS.approveByCountry);
      const obj = raw ? JSON.parse(raw) : {};
      return (obj && typeof obj === 'object') ? obj : {};
    }catch{ return {}; }
  }
  function writeApproveMap(map){
    try{ localStorage.setItem(LS_KEYS.approveByCountry, JSON.stringify(map)); }catch{}
  }
  function updateApproveUIFromStorage(){
    const iso3 = getCurrentISO3();
    const map = readApproveMap();
    const saved = Array.isArray(map[iso3]) ? map[iso3] : [];
    document.querySelectorAll('.gl-approve').forEach(chk=>{ chk.checked = saved.includes(chk.value); });
  }

  // Subtab switching
  tabs.querySelectorAll('.subtab-button').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      tabs.querySelectorAll('.subtab-button').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode;
      // encode mode in parent URL
      try{
        const url = new URL(location.href);
        url.searchParams.set('gl', mode);
        history.replaceState({ tab: 'geolayers', gl: mode }, '', url);
      }catch{}
      if(mode==='admin'){
        controls.style.display='flex';
        // Build from saved state instead of forcing 'rivers'
        const savedLayers = (localStorage.getItem(LS_KEYS.layers) || 'rivers');
        const savedCountry = localStorage.getItem(LS_KEYS.country) || '';
        const url = new URL('geolayers-game/public/index.v20250901.html', location.href);
        url.searchParams.set('admin','1');
        if(savedCountry) url.searchParams.set('country', savedCountry);
        url.searchParams.set('layers', savedLayers);
        frame.src = url.toString();
        // Reflect per-country approvals in the UI
        updateApproveUIFromStorage();
      }else{
        controls.style.display='none';
        const url = new URL('geolayers-game/public/index.v20250901.html', location.href);
        url.searchParams.set('layers','rivers');
        frame.src = url.toString();
      }
    });
  });

  function updateFrame(){
    const iso3 = resolveISO3(document.getElementById('glCountry').value);
    const layers = Array.from(document.querySelectorAll('.gl-layer:checked')).map(i=>i.value).join(',');
    try{ localStorage.setItem(LS_KEYS.layers, layers || 'rivers'); }catch{}
    try{ if(iso3) localStorage.setItem(LS_KEYS.country, iso3); }catch{}
    const url = new URL('geolayers-game/public/index.v20250901.html', location.href);
    url.searchParams.set('admin','1');
    if(iso3) url.searchParams.set('country', iso3);
    url.searchParams.set('layers', layers || 'rivers');
    document.getElementById('geolayersFrame').src = url.toString();
  }

  function sendLayerUpdate(){
    const win = frame && frame.contentWindow;
    if(!win) return;
    const layers = Array.from(document.querySelectorAll('.gl-layer:checked')).map(i=>i.value);
    try{ localStorage.setItem(LS_KEYS.layers, layers.join(',') || 'rivers'); }catch{}
    try{
      win.postMessage({ type:'geolayers:setLayers', layers }, '*');
    }catch{}
  }

  let lastSentCountry = '';
  function sendCountryUpdate(){
    const iso3 = resolveISO3(document.getElementById('glCountry').value);
    if(!iso3) return;
    if(iso3 === lastSentCountry) return;
    lastSentCountry = iso3;
    try{ localStorage.setItem(LS_KEYS.country, iso3); }catch{}
    const win = frame && frame.contentWindow;
    if(!win) return;
    try{ win.postMessage({ type:'geolayers:setCountry', country: iso3 }, '*'); }catch{}
  }

  // Live update on layer checkbox change
  document.querySelectorAll('.gl-layer').forEach(chk=>{
    chk.addEventListener('change', sendLayerUpdate);
  });

  // Live update on country input (debounced); use postMessage instead of reloading iframe
  const countryInput = document.getElementById('glCountry');
  let t=null;
  countryInput.addEventListener('input', ()=>{ if(t) clearTimeout(t); t=setTimeout(()=>{ sendCountryUpdate(); updateApproveUIFromStorage(); }, 700); });
  countryInput.addEventListener('change', ()=>{ sendCountryUpdate(); updateApproveUIFromStorage(); });

  // Restore saved state for country, layers, approvals
  try{
    const savedCountry = localStorage.getItem(LS_KEYS.country);
    if(savedCountry){
      // Try to set a friendly country name if present in datalist map
      const nameMap = JSON.parse(document.getElementById('glCountry').dataset._codeMap || '{}');
      const entry = Object.entries(nameMap).find(([,code])=>code===savedCountry);
      if(entry){ countryInput.value = entry[0]; }
      else { countryInput.value = savedCountry; }
    }
  }catch{}
  try{
    const savedLayers = (localStorage.getItem(LS_KEYS.layers) || 'rivers').split(',').map(s=>s.trim()).filter(Boolean);
    document.querySelectorAll('.gl-layer').forEach(chk=>{ chk.checked = savedLayers.includes(chk.value); });
  }catch{}
  updateApproveUIFromStorage();

  // Persist approvals when they change
  document.querySelectorAll('.gl-approve').forEach(chk=>{
    chk.addEventListener('change', ()=>{
      const iso3 = getCurrentISO3();
      const values = Array.from(document.querySelectorAll('.gl-approve:checked')).map(i=>i.value);
      const map = readApproveMap();
      map[iso3] = values;
      writeApproveMap(map);
    });
  });

  // Initial update if admin tab active by default
  // Read gl=game|admin from URL
  try{
    const params = new URLSearchParams(location.search);
    const gl = params.get('gl');
    if(gl === 'admin'){
      const adminBtn = tabs.querySelector('.subtab-button[data-mode="admin"]');
      if(adminBtn){ adminBtn.click(); }
    } else {
      const gameBtn = tabs.querySelector('.subtab-button[data-mode="game"]');
      if(gameBtn){ gameBtn.click(); }
    }
  }catch{}
}

if(typeof window!=='undefined') window.initGeolayersAdmin = initGeolayersAdmin;
