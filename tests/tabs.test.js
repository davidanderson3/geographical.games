/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import '../js/tabs.js';

describe('main tab behavior', () => {
  it('ignores clicks on subtabs without data-target', () => {
    document.body.innerHTML = `
      <nav>
        <div id="tabsContainer">
          <button class="tab-button" data-target="geoscorePanel">GeoScore Admin</button>
          <button class="tab-button" data-target="geoscoreGamePanel">GeoScore Game</button>
          <button class="tab-button" data-target="geolayersPanel">GeoLayers</button>
        </div>
      </nav>
      <section id="geoscorePanel"></section>
      <section id="geoscoreGamePanel" style="display:none;">
        <div id="geoscoreGameSubtabs">
          <button class="tab-button" data-mode="world">World</button>
          <button class="tab-button" data-mode="us">US</button>
        </div>
      </section>
      <section id="geolayersPanel" style="display:none;"></section>
    `;

    document.dispatchEvent(new Event('DOMContentLoaded'));
    const mainVisibleBefore = document.getElementById('geoscorePanel').style.display;

    document.querySelector('#geoscoreGameSubtabs .tab-button').click();

    const mainVisibleAfter = document.getElementById('geoscorePanel').style.display;
    expect(mainVisibleAfter).toBe(mainVisibleBefore);
  });
});
