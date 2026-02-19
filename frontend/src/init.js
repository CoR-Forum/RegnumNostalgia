/**
 * Game Init — bootstrap(), initGame(), HTML-partial loaders.
 *
 * Called by main.js loadGame() AFTER successful authentication.
 * No login/auth logic lives here — that is handled by login.js.
 */

import { gameState, batchUpdate } from './state.js';
import { apiCall } from './api.js';
import { getMap, getTotalH, getTotalW, gameToLatLng, getMapCenter, getDefaultZoom } from './map-state.js';
import { initializeWebSocket } from './socket-client.js';
import { showPlayerInfo, updatePlayerCoords, initHudButtons } from './player-ui.js';
import { createPlayerMarker } from './player.js';
import { enableClickToMove, buildGoHereIcon } from './walking.js';
import { initWindows, initWindow, saveWindowState, getWindowState } from './windows.js';
import { initInventoryDropZone } from './inventory.js';
import { initSpellsUI } from './spells.js';
import { initQuickbar } from './quickbar.js';

/**
 * Load an HTML partial into a container element.
 * Injects non-script nodes, then executes inline/external scripts.
 */
function loadPartial(url, containerId) {
  return fetch(url)
    .then((r) => r.text())
    .then((html) => {
      const container = document.getElementById(containerId);
      if (!container) return;
      const tmp = document.createElement('div');
      tmp.innerHTML = html;

      // Move non-script nodes into the container
      Array.from(tmp.childNodes).forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE && node.tagName.toLowerCase() === 'script') return;
        container.appendChild(node);
      });

      // Execute inline/external scripts (skip Vite dev injections)
      const scripts = tmp.querySelectorAll('script');
      scripts.forEach((s) => {
        if (s.src && (s.src.includes('@vite') || s.src.includes('vite/client'))) return;
        const ns = document.createElement('script');
        if (s.type) ns.type = s.type;
        if (s.src) ns.src = s.src;
        else ns.textContent = s.textContent;
        document.body.appendChild(ns);
      });
    })
    .catch((err) => console.error(`Failed to load ${url}:`, err));
}

/**
 * Load all HTML partials (character, settings, info-box, shoutbox).
 */
async function loadHtmlPartials() {
  // Load character, settings, info-box in parallel
  await Promise.all([
    loadPartial('character.html', 'character-include'),
    loadPartial('settings.html', 'settings-include'),
    loadPartial('info-box.html', 'mini-info-include'),
  ]);

  // Re-initialize windows after partials are loaded
  try { initWindows(); } catch (e) { /* ignore */ }
}

/**
 * Load shoutbox partial and initialize its window.
 */
function loadShoutbox() {
  loadPartial('shoutbox.html', 'shoutbox-include').then(() => {
    try {
      const shoutboxWin = document.getElementById('shoutbox-window');
      if (shoutboxWin) {
        const shoutboxState = getWindowState('shoutbox-window');
        if (!shoutboxState || typeof shoutboxState.open === 'undefined') {
          saveWindowState('shoutbox-window', { open: true, display: 'flex' });
          shoutboxWin.style.display = 'flex';
        }
      }
      initWindow({ id: 'shoutbox-window', headerId: 'shoutbox-header', closeId: 'shoutbox-close-btn' });
    } catch (e) { console.error('Failed to initialize shoutbox window:', e); }
  });
}

/**
 * Initialize the game world (map, websocket, player state, UI).
 * Called by bootstrap() with progress reporting.
 *
 * @param {(message: string, percent: number) => void} progress
 */
async function initGame(progress) {
  try {
    // Initialize the Leaflet map
    progress('Initializing map...', 40);
    await import('./map-init.js').then((mod) => mod.initMap());

    const map = getMap();
    const totalH = getTotalH();
    const totalW = getTotalW();

    // Connect WebSocket
    progress('Connecting to server...', 55);
    initializeWebSocket();

    // Wait for socket to connect (or timeout)
    await new Promise((resolve) => {
      if (window.socket && window.socket.connected) return resolve();
      const onConnect = () => { cleanup(); resolve(); };
      const timeout = setTimeout(() => { cleanup(); resolve(); }, 3000);
      function cleanup() {
        clearTimeout(timeout);
        if (window.socket) window.socket.off('connect', onConnect);
      }
      if (window.socket) {
        window.socket.once('connect', onConnect);
      } else {
        cleanup();
        resolve();
      }
    });

    // Request initial player state via WebSocket
    progress('Loading player data...', 65);
    let data = null;
    const requestPlayerState = () => new Promise((resolve) => {
      if (window.socket && window.socket.connected) {
        window.socket.emit('player:stats:get', (resp) => {
          if (resp && resp.success && resp.state) return resolve(resp.state);
          resolve(null);
        });
        setTimeout(() => resolve(null), 1500);
      } else {
        resolve(null);
      }
    });

    data = await requestPlayerState();
    if (data && data.position) {
      gameState.position = data.position;
      batchUpdate({
        realm: data.realm ?? gameState.realm,
        username: typeof data.username !== 'undefined' ? data.username : gameState.username,
        health: data.health ?? gameState.health,
        maxHealth: data.maxHealth ?? gameState.maxHealth,
        mana: data.mana ?? gameState.mana,
        maxMana: data.maxMana ?? gameState.maxMana,
        damage: typeof data.damage !== 'undefined' ? data.damage : 0,
        armor: typeof data.armor !== 'undefined' ? data.armor : 0,
        xp: typeof data.xp !== 'undefined' ? data.xp : 0,
        level: typeof data.level !== 'undefined' ? data.level : 1,
        xpToNext: typeof data.xpToNext !== 'undefined' ? data.xpToNext : 0,
        stats: data.stats || { intelligence: 20, dexterity: 20, concentration: 20, strength: 20, constitution: 20 },
      });
    } else {
      console.warn('No initial player state received via WebSocket; waiting for server emission');
    }

    // Verify session via HTTP (fallback)
    progress('Verifying session...', 75);
    try {
      await apiCall('/login/validate');
    } catch (httpErr) {
      const msg = String(httpErr && httpErr.message ? httpErr.message : '');
      const status = httpErr && typeof httpErr.status !== 'undefined' ? httpErr.status : null;
      const authFailure = (status === 401 || status === 403) || /invalid|expired|unauthor/i.test(msg);
      const playerNotFound = /player not found/i.test(msg);
      if (authFailure || playerNotFound) throw httpErr;
    }

    // Use gameState as fallback if no data received
    if (!(data && data.position)) {
      if (gameState && gameState.position && typeof gameState.position.x === 'number' && typeof gameState.position.y === 'number') {
        data = {
          position: gameState.position,
          realm: gameState.realm,
          username: gameState.username,
          health: gameState.health,
          maxHealth: gameState.maxHealth,
          mana: gameState.mana,
          maxMana: gameState.maxMana,
          damage: gameState.damage,
          armor: gameState.armor,
          xp: gameState.xp,
          level: gameState.level,
          xpToNext: gameState.xpToNext,
          stats: gameState.stats,
        };
      } else {
        throw new Error('No player state received');
      }
    }

    // Prepare game world
    progress('Preparing game world...', 82);

    // Allow layout to settle, then invalidate Leaflet size
    try {
      setTimeout(() => {
        try {
          if (map && typeof map.invalidateSize === 'function') {
            map.invalidateSize();
            map.setView(getMapCenter(), getDefaultZoom());
          }
        } catch (e) {}
      }, 100);
    } catch (e) {}

    // Ensure regions are rendered after resize
    try {
      setTimeout(() => {
        try { if (window.loadAndRenderRegions && typeof window.loadAndRenderRegions === 'function') window.loadAndRenderRegions(); } catch (e) {}
      }, 250);
    } catch (e) {}

    showPlayerInfo();
    createPlayerMarker(gameState.position.x, gameState.position.y);

    // Restore walker path if server provided one
    try {
      if (data.walker && data.walker.positions && window.buildPath && typeof window.buildPath.setWalkerPositions === 'function') {
        window.buildPath.setWalkerPositions(data.walker.positions, typeof data.walker.currentIndex === 'number' ? data.walker.currentIndex : 0);
      }
    } catch (e) { console.debug('drawWalkPath on init failed', e); }

    // Restore walker destination marker
    try {
      if (data.walker && data.walker.destination) {
        const dest = data.walker.destination;
        const dx = parseInt(dest[0], 10);
        const dy = parseInt(dest[1], 10);
        if (gameState.walkDestinationMarker) {
          try { map.removeLayer(gameState.walkDestinationMarker); } catch (e) {}
        }
        gameState.walkDestinationMarker = L.marker(gameToLatLng(dx, dy), { icon: buildGoHereIcon(), riseOnHover: true }).addTo(map);
        gameState.walkingTarget = { x: dx, y: dy };
      }
    } catch (e) { console.debug('init: set walkDestinationMarker failed', e); }

    // Load paths if enabled
    if (gameState.showPaths && typeof window.loadAndRenderPaths === 'function') await window.loadAndRenderPaths();

    enableClickToMove();
    updatePlayerCoords(gameState.position.x, gameState.position.y);

    // Initialize active spells UI
    try { initSpellsUI(); } catch (e) { console.debug('initSpellsUI failed', e); }

    // Initialize quickbar
    try { initQuickbar(); } catch (e) { console.debug('initQuickbar failed', e); }

  } catch (error) {
    console.error('[InitGame] Failed:', error && error.message ? error.message : error);

    // Clear auth on session errors so login.js will show login on reload
    try {
      const msg = String((error && error.message) ? error.message : '');
      const status = (error && typeof error.status !== 'undefined') ? error.status : null;
      const authFailure = (status === 401 || status === 403) || /invalid|expired|unauthor/i.test(msg);
      const playerNotFound = /player not found/i.test(msg);
      if (authFailure || playerNotFound) {
        try { localStorage.removeItem('sessionToken'); } catch (e) {}
        try { sessionStorage.removeItem('sessionToken'); } catch (e) {}
        try { gameState.sessionToken = null; } catch (e) {}
      }
    } catch (e) {}

    throw error;
  }
}

// Expose initGame globally for backward compatibility
window.initGame = initGame;

/**
 * Sync the --hud-height CSS variable to the actual rendered height of the
 * bottom HUD bar image so the map always ends exactly where the HUD begins.
 */
function syncHudHeight() {
  const overlay = document.getElementById('ui-image-overlay');
  if (!overlay) return;
  const apply = () => {
    // Prefer the bar image height; fall back to the overlay element height
    const img = overlay.querySelector('.ui-bar-right img');
    const h = img ? img.getBoundingClientRect().height : overlay.getBoundingClientRect().height;
    if (h > 0) document.documentElement.style.setProperty('--hud-height', h + 'px');
  };
  apply();
  new ResizeObserver(apply).observe(overlay);
}

/**
 * Bootstrap the game: init UI, load partials, then run initGame.
 * Called by main.js loadGame() with a progress callback.
 *
 * @param {(message: string, percent: number) => void} progressCallback
 */
export async function bootstrap(progressCallback) {
  const progress = progressCallback || (() => {});

  // Sync HUD height CSS variable for map layout
  syncHudHeight();

  // Initialize draggable/closable windows
  progress('Setting up interface...', 36);
  initWindows();
  initHudButtons();
  initInventoryDropZone();

  // Load HTML partials (character, settings, info-box)
  progress('Loading interface...', 38);
  await loadHtmlPartials();

  // Load shoutbox (must complete before WebSocket init to avoid race condition)
  await loadShoutbox();

  // Initialize game world (map, websocket, player data)
  await initGame(progress);
}

