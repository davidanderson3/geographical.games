async function initGeolayersAdmin(){
  const tabs = document.getElementById('geolayersSubtabs');
  const controls = document.getElementById('geolayersAdminControls');
  const frame = document.getElementById('geolayersFrame');
  if(!tabs || !controls || !frame) return;

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
        // Default admin view keeps current country, shows rivers
        const url = new URL(frame.src, location.href);
        url.searchParams.set('admin','1');
        url.searchParams.set('layers','rivers');
        frame.src = url.toString();
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
    const url = new URL('geolayers-game/public/index.v20250901.html', location.href);
    url.searchParams.set('admin','1');
    if(iso3) url.searchParams.set('country', iso3);
    url.searchParams.set('layers', layers || 'rivers');
    document.getElementById('geolayersFrame').src = url.toString();
  }

  // Live update on layer checkbox change
  document.querySelectorAll('.gl-layer').forEach(chk=>{
    chk.addEventListener('change', updateFrame);
  });

  // Live update on country input (debounced)
  const countryInput = document.getElementById('glCountry');
  let t=null;
  countryInput.addEventListener('input', ()=>{ if(t) clearTimeout(t); t=setTimeout(updateFrame, 300); });
  countryInput.addEventListener('change', updateFrame);

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
