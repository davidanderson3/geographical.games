async function initGeolayersAdmin(){
  const tabs = document.getElementById('geolayersSubtabs');
  const controls = document.getElementById('geolayersAdminControls');
  const frame = document.getElementById('geolayersFrame');
  if(!tabs || !controls || !frame) return;

  const LS_KEYS = {
    country: 'gl_admin_country',
    layers: 'gl_admin_layers',
    // Stores JSON: { ISO3: ["rivers","cities",...] }
    approveByCountry: 'gl_admin_approve_by_country',
    excluded: 'gl_admin_excluded_countries'
  };

  let countriesData = [];
  function readExcluded(){
    try{
      const raw = localStorage.getItem(LS_KEYS.excluded);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    }catch{ return []; }
  }
  function writeExcluded(arr){
    try{ localStorage.setItem(LS_KEYS.excluded, JSON.stringify(arr)); }catch{}
  }
  function buildCountryList(){
    const list = document.getElementById('glList');
    const input = document.getElementById('glCountry');
    list.innerHTML = '';
    const excluded = readExcluded();
    for(const c of countriesData){
      if(excluded.includes(c.code)) continue;
      const btn = document.createElement('button');
      btn.textContent = c.name;
      btn.dataset.iso3 = c.code;
      btn.addEventListener('click', ()=>{
        input.value = c.code;
        list.querySelectorAll('button').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        sendCountryUpdate();
        updateApproveUIFromStorage();
      });
      list.appendChild(btn);
    }
    const saved = getCurrentISO3();
    if(saved){
      input.value = saved;
      const btn = list.querySelector(`button[data-iso3="${saved}"]`);
      if(btn) btn.classList.add('active');
    }
  }

  // Populate countries list
  try{
    const res = await fetch('geolayers-game/public/countries.json');
    countriesData = await res.json();
    countriesData.sort((a,b)=>a.name.localeCompare(b.name));
    buildCountryList();
  }catch{}

  function resolveISO3(val){
    const n = String(val||'').trim().toUpperCase();
    return n.length === 3 ? n : '';
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
        document.getElementById('glList').style.display='block';
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
        document.getElementById('glList').style.display='none';
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

  // Restore saved state for layers, approvals
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

  // Exclusion controls
  const excludeBtn = document.getElementById('glExcludeCountry');
  if(excludeBtn){
    excludeBtn.addEventListener('click', ()=>{
      const iso3 = getCurrentISO3();
      if(!iso3) return;
      const ex = readExcluded();
      if(!ex.includes(iso3)){
        ex.push(iso3);
        writeExcluded(ex);
      }
      document.getElementById('glCountry').value = '';
      try{ localStorage.removeItem(LS_KEYS.country); }catch{}
      lastSentCountry = '';
      buildCountryList();
      updateApproveUIFromStorage();
      updateFrame();
    });
  }
  const resetBtn = document.getElementById('glResetExcluded');
  if(resetBtn){
    resetBtn.addEventListener('click', ()=>{
      writeExcluded([]);
      buildCountryList();
    });
  }

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
