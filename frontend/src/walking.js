/**
 * Walking — click-to-move, performWalkAtLatLng, buildGoHereIcon, enableClickToMove.
 */

import { gameState } from './state.js';
import { getMap, getTotalH } from './map-state.js';
import { showMapContextMenuAt, hideMapContextMenu, setLastContextAllowed } from './context-menu.js';

/**
 * Create the yellow "go here" destination icon.
 */
export const buildGoHereIcon = () => L.divIcon({
  className: 'custom-go-here-marker',
  html: `<div style="width:14px;height:14px;background:#ffd700;border:2px solid #fff;border-radius:50%;box-shadow:0 0 6px rgba(255,215,0,0.8);"></div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

/**
 * Start walking toward a map location. Server computes path and advances via cron.
 */
export async function performWalkAtLatLng(latlng) {
  const totalH = getTotalH();
  const x = Math.round(latlng.lng);
  const y = Math.round(totalH - latlng.lat);

  if (x < 0 || x > 6144 || y < 0 || y > 6144) return;

  try {
    // Prevent walking into non-walkable or foreign-owned regions
    try {
      const allowed = await window.isLatLngWalkAllowedAsync(latlng);
      if (!allowed) { try { if (window.addLogMessage) window.addLogMessage('Cannot walk to that region.', 'error'); else alert('Cannot walk to that region.'); } catch (e) { alert('Cannot walk to that region.'); } return; }
    } catch (e) { console.debug('region check before walk failed', e); try { if (window.addLogMessage) window.addLogMessage('Cannot walk to that region.', 'error'); else alert('Cannot walk to that region.'); } catch (ex) { alert('Cannot walk to that region.'); } return; }

    const socket = window.getSocket && window.getSocket();
    if (!socket || !socket.connected) {
      alert('WebSocket not connected');
      return;
    }

    socket.emit('move:request', { x, y });
    gameState.walkingTarget = { x, y };
  } catch (err) {
    console.error('Failed to start walking:', err);
    if (window.addLogMessage) window.addLogMessage('Failed to start walking: ' + (err.message || 'Unknown error'), 'error');
  }
}

/**
 * Bind click/contextmenu handlers to the Leaflet map for walking and context menu.
 */
export function enableClickToMove() {
  const map = getMap();

  // Left-click to walk; Shift+click opens context menu
  map.on('click', async (e) => {
    // If build-path mode is active, let the builder handle the click
    if (gameState.buildPathMode && window.buildPath && typeof window.buildPath.onMapClick === 'function') {
      try { window.buildPath.onMapClick(e); } catch (err) { console.error(err); }
      return;
    }

    hideMapContextMenu();

    const shiftPressed = !!(e.originalEvent && e.originalEvent.shiftKey);
    if (shiftPressed) {
      try {
        setLastContextAllowed(await window.isLatLngWalkAllowedAsync(e.latlng));
      } catch (err) { setLastContextAllowed(false); }
      showMapContextMenuAt(e.containerPoint, e.latlng);
      return;
    }

    try {
      const allowed = await window.isLatLngWalkAllowedAsync(e.latlng);
      if (!allowed) { try { if (window.addLogMessage) window.addLogMessage('Cannot walk to that region.', 'error'); else alert('Cannot walk to that region.'); } catch (e) { alert('Cannot walk to that region.'); } return; }
      await performWalkAtLatLng(e.latlng);
    } catch (err) {
      console.error('Click walk failed', err);
      try { if (window.addLogMessage) window.addLogMessage('Failed to start walking: ' + (err && err.message ? err.message : 'Unknown error'), 'error'); } catch (e) {}
    }
  });

  // Hide menu on viewport change
  map.on('movestart zoomstart', () => hideMapContextMenu());

  // Right-click opens context menu
  map.on('contextmenu', async (e) => {
    if (e.originalEvent && typeof e.originalEvent.preventDefault === 'function') e.originalEvent.preventDefault();
    try {
      setLastContextAllowed(await window.isLatLngWalkAllowedAsync(e.latlng));
    } catch (err) { setLastContextAllowed(false); }
    showMapContextMenuAt(e.containerPoint, e.latlng);
  });
}
