function initTabs() {
  const buttons = Array.from(document.querySelectorAll('.tab-button'));
  const panels = {
    geoscorePanel: document.getElementById('geoscorePanel'),
    geoscoreGamePanel: document.getElementById('geoscoreGamePanel'),
    geolayersPanel: document.getElementById('geolayersPanel')
  };

  function adjustGeolayersFrame() {
    const panel = panels.geolayersPanel;
    const frame = document.getElementById('geolayersFrame');
    if (!panel || !frame || panel.style.display === 'none') return;
    const rect = panel.getBoundingClientRect();
    const available = Math.max(200, window.innerHeight - rect.top);
    frame.style.height = available + 'px';
  }

  const idToParam = (id) => (id === 'geolayersPanel' ? 'geolayers' : (id==='geoscoreGamePanel'?'geoscoreGame':'geoscoreAdmin'));
  const paramToId = (p) => (p === 'geolayers' ? 'geolayersPanel' : (p==='geoscoreGame'?'geoscoreGamePanel':'geoscorePanel'));

  function setActive(targetId, push) {
    // Update tab styles and panels
    buttons.forEach(b => b.classList.toggle('active', b.dataset.target === targetId));
    Object.entries(panels).forEach(([id, el]) => {
      el.style.display = id === targetId ? 'flex' : 'none';
    });
    if (targetId === 'geoscorePanel') {
      window.initGeoScorePanel && window.initGeoScorePanel();
    } else if (targetId === 'geoscoreGamePanel') {
      window.initGeoScoreGame && window.initGeoScoreGame();
    } else if (targetId === 'geolayersPanel') {
      adjustGeolayersFrame();
      window.initGeolayersAdmin && window.initGeolayersAdmin();
    }
    // Update URL ?tab=...
    try {
      const url = new URL(location.href);
      url.searchParams.set('tab', idToParam(targetId));
      if (push) history.pushState({ tab: idToParam(targetId) }, '', url);
      else history.replaceState({ tab: idToParam(targetId) }, '', url);
    } catch {}
  }

  buttons.forEach(btn => {
    btn.addEventListener('click', () => setActive(btn.dataset.target, true));
  });

  // Initialize from URL (?tab=geoscore|geolayers) or default to geoscore
  const params = new URLSearchParams(location.search);
  const tabParam = params.get('tab');
  const initialId = (tabParam && panels[paramToId(tabParam)]) ? paramToId(tabParam) : 'geoscorePanel';
  setActive(initialId, false);

  // Handle back/forward
  window.addEventListener('popstate', () => {
    const p = new URLSearchParams(location.search).get('tab');
    const id = (p && panels[paramToId(p)]) ? paramToId(p) : 'geoscorePanel';
    setActive(id, false);
  });

  window.addEventListener('resize', adjustGeolayersFrame);
}

document.addEventListener('DOMContentLoaded', initTabs);
