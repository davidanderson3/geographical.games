function initTabs() {
  const buttons = Array.from(document.querySelectorAll('.tab-button'));
  const panels = {
    geoscorePanel: document.getElementById('geoscorePanel'),
    geolayersPanel: document.getElementById('geolayersPanel')
  };

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      Object.entries(panels).forEach(([id, el]) => {
        el.style.display = id === btn.dataset.target ? 'flex' : 'none';
      });
      if (btn.dataset.target === 'geoscorePanel') {
        window.initGeoScorePanel && window.initGeoScorePanel();
      }
    });
  });

  // initialize default view
  window.initGeoScorePanel && window.initGeoScorePanel();
}

document.addEventListener('DOMContentLoaded', initTabs);

