/**
 * Context Menu — map right-click menu with "Walk here", "Copy Coords", "Screenshots", "Region Editor".
 */

import { getMap, latLngToGame } from './map-state.js';
import { performWalkAtLatLng } from './walking.js';

let __lastContextLatLng = null;
let __mapContextMenuEl = null;
let __lastContextAllowed = null;

export function setLastContextAllowed(v) { __lastContextAllowed = v; }

export function createMapContextMenu() {

  __mapContextMenuEl = document.createElement('div');
  __mapContextMenuEl.id = 'map-contextmenu';
  __mapContextMenuEl.className = 'map-contextmenu';
  __mapContextMenuEl.innerHTML = '<div class="map-contextmenu-item" id="map-walk-here">Walk here</div><div class="map-contextmenu-item" id="map-copy-coords">Copy Coords</div><div class="map-contextmenu-item" id="map-screenshots">Screenshots</div>';
  document.body.appendChild(__mapContextMenuEl);

  __mapContextMenuEl.querySelector('#map-walk-here').addEventListener('click', async (ev) => {
    ev.stopPropagation();
    if (!__lastContextLatLng) return hideMapContextMenu();
    try {
      const ll = (typeof L !== 'undefined' && L && L.latLng) ? L.latLng(__lastContextLatLng.lat, __lastContextLatLng.lng) : __lastContextLatLng;
      try {
        const allowed = await window.isLatLngWalkAllowedAsync(ll);
        if (!allowed) { try { if (window.addLogMessage) window.addLogMessage('Cannot walk to that region.', 'error'); else alert('Cannot walk to that region.'); } catch (e) { alert('Cannot walk to that region.'); } hideMapContextMenu(); return; }
      } catch (e) { console.error('Walk permission check failed', e); try { if (window.addLogMessage) window.addLogMessage('Cannot walk to that region.', 'error'); else alert('Cannot walk to that region.'); } catch (ex) { alert('Cannot walk to that region.'); } hideMapContextMenu(); return; }
      await performWalkAtLatLng(ll);
    } catch (err) {
      console.error('performWalkAtLatLng failed', err);
    }
    hideMapContextMenu();
  });

  __mapContextMenuEl.querySelector('#map-copy-coords').addEventListener('click', async (ev) => {
    ev.stopPropagation();
    if (!__lastContextLatLng) return hideMapContextMenu();
    const game = latLngToGame(__lastContextLatLng);
    const x = Math.round(game.x);
    const y = Math.round(game.y);
    const text = `[${x}, ${y}]`;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      const temp = document.createElement('div');
      temp.className = 'map-contextmenu-temp';
      temp.style.padding = '8px';
      temp.style.color = '#fff';
      temp.style.pointerEvents = 'none';
      temp.textContent = 'Copied ' + text;
      __mapContextMenuEl.appendChild(temp);
      setTimeout(() => { if (temp.parentNode) temp.parentNode.removeChild(temp); hideMapContextMenu(); }, 700);
    } catch (e) {
      console.error('Copy failed', e);
      hideMapContextMenu();
    }
  });

  // Region Editor item
  const buildItem = document.createElement('div');
  buildItem.className = 'map-contextmenu-item';
  buildItem.id = 'map-build-path';
  buildItem.textContent = 'Region Editor';
  __mapContextMenuEl.appendChild(buildItem);
  buildItem.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    hideMapContextMenu();
    try { if (window.buildPath && typeof window.buildPath.showPanel === 'function') window.buildPath.showPanel(); } catch (e) { console.error(e); }
  });

  // Screenshots item
  __mapContextMenuEl.querySelector('#map-screenshots').addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const ll = __lastContextLatLng;
    hideMapContextMenu();
    if (ll && window.screenshotManager && typeof window.screenshotManager.openModal === 'function') {
      const game = latLngToGame(ll);
      const x = Math.round(game.x);
      const y = Math.round(game.y);
      window.screenshotManager.openModal(x, y);
    }
  });

  // Hide menu on outside click / Escape
  document.addEventListener('click', (ev) => { if (__mapContextMenuEl && !__mapContextMenuEl.contains(ev.target)) hideMapContextMenu(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') hideMapContextMenu(); });
}

export function showMapContextMenuAt(containerPoint, latlng) {
  const map = getMap();
  if (!__mapContextMenuEl) createMapContextMenu();
  __lastContextLatLng = latlng;
  const rect = map.getContainer().getBoundingClientRect();
  __mapContextMenuEl.style.left = (rect.left + containerPoint.x) + 'px';
  __mapContextMenuEl.style.top = (rect.top + containerPoint.y) + 'px';
  __mapContextMenuEl.style.display = 'block';

  try {
    const walkItem = __mapContextMenuEl.querySelector('#map-walk-here');
    if (walkItem) {
      if (typeof __lastContextAllowed === 'boolean') {
        walkItem.style.display = __lastContextAllowed ? 'block' : 'none';
        walkItem.title = __lastContextAllowed ? '' : 'Cannot walk to that region';
        __lastContextAllowed = null;
      } else {
        walkItem.style.display = 'none';
        walkItem.title = 'Checking...';
        (async () => {
          try {
            const allowed = await window.isLatLngWalkAllowedAsync(latlng);
            walkItem.style.display = allowed ? 'block' : 'none';
            walkItem.title = allowed ? '' : 'Cannot walk to that region';
          } catch (e) {
            walkItem.style.display = 'none';
            walkItem.title = 'Cannot walk to that region';
          }
        })();
      }
    }
  } catch (e) { /* ignore */ }
}

export function hideMapContextMenu() {
  if (!__mapContextMenuEl) return;
  __mapContextMenuEl.style.display = 'none';
  __lastContextLatLng = null;
}
