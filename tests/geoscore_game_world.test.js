/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { initGeoScoreGame } from '../js/geoscore_game.js';

describe('geoscore world game', () => {
  beforeEach(() => {
    const store = {};
    global.localStorage = {
      getItem: key => (key in store ? store[key] : null),
      setItem: (key, val) => { store[key] = String(val); },
      removeItem: key => { delete store[key]; }
    };
    global.fetch = async () => ({ ok: false });
    document.body.innerHTML = '<div id="geoscoreGame"></div>';
  });

  it('builds questions for world mode', async () => {
    await initGeoScoreGame();
    document.querySelector('#geoscoreGame button').click();
    await new Promise(r => setTimeout(r, 0));
    expect(document.querySelectorAll('#geoscoreGame .geoscore-qcard').length).toBeGreaterThan(0);
  });
});
