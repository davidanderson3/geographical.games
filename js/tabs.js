function initTabs() {
  const buttons = Array.from(document.querySelectorAll('.tab-button'));
  const panels = {
    geoscorePanel: document.getElementById('geoscorePanel'),
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

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      Object.entries(panels).forEach(([id, el]) => {
        el.style.display = id === btn.dataset.target ? 'flex' : 'none';
      });
      if (btn.dataset.target === 'geoscorePanel') {
        window.initGeoScorePanel && window.initGeoScorePanel();
      } else if (btn.dataset.target === 'geolayersPanel') {
        adjustGeolayersFrame();
      }
    });
  });

  // initialize default view
  window.initGeoScorePanel && window.initGeoScorePanel();

  window.addEventListener('resize', () => {
    adjustGeolayersFrame();
  });
}

document.addEventListener('DOMContentLoaded', initTabs);
