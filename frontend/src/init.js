/**
 * Game Init — initGame(), checkAutoLogin(), HTML-partial loaders.
 */

import { gameState, batchUpdate } from './state.js';
import { apiCall } from './api.js';
import { getMap, getTotalH, getTotalW } from './map-state.js';
import { initializeWebSocket } from './socket-client.js';
import { showPlayerInfo, updatePlayerCoords } from './player-ui.js';
import { createPlayerMarker } from './player.js';
import { enableClickToMove, buildGoHereIcon } from './walking.js';
import { initWindows, initWindow, saveWindowState, getWindowState } from './windows.js';
import { initInventoryDropZone } from './inventory.js';

let _autoLoginFallback = null;

/**
 * Initialize the game after successful login / realm selection.
 */
export async function initGame() {
  try {
    const map = getMap();
    const totalH = getTotalH();
    const totalW = getTotalW();

    // Request initial player state via WebSocket
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

    // Validate session: prefer socket-provided state, verify via HTTP
    let httpPlayerData = null;
    try {
      httpPlayerData = await apiCall('/player/position');
      if (!(data && data.position)) data = httpPlayerData;
    } catch (httpErr) {
      const msg = String(httpErr && httpErr.message ? httpErr.message : '');
      const status = httpErr && typeof httpErr.status !== 'undefined' ? httpErr.status : null;
      const authFailure = (status === 401 || status === 403) || /invalid|expired|unauthor/i.test(msg);
      const playerNotFound = /player not found/i.test(msg);
      if (authFailure || playerNotFound) throw httpErr;
    }

    // Check if realm is selected
    if (data && (!data.realm || data.realm === null || data.realm === '')) {
      if (typeof window.showRealmSelection === 'function') {
        window.showRealmSelection();
        return;
      }
    }

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

    document.body.classList.add('authenticated');

    // Allow layout to settle, then invalidate Leaflet size
    try {
      setTimeout(() => {
        try {
          if (map && typeof map.invalidateSize === 'function') {
            map.invalidateSize();
            map.setView([totalH / 2, totalW / 2], -2);
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

    hideModal();
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
        gameState.walkDestinationMarker = L.marker([totalH - dy, dx], { icon: buildGoHereIcon(), riseOnHover: true }).addTo(map);
        gameState.walkingTarget = { x: dx, y: dy };
      }
    } catch (e) { console.debug('init: set walkDestinationMarker failed', e); }

    // Load paths if enabled
    if (gameState.showPaths && typeof window.loadAndRenderPaths === 'function') await window.loadAndRenderPaths();

    enableClickToMove();
    initializeWebSocket();
    updatePlayerCoords(gameState.position.x, gameState.position.y);
  } catch (error) {
    console.debug('initGame failed, returning to login:', error && error.message ? error.message : error);
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

    try {
      const loginForm = document.getElementById('login-form');
      const autoLoginLoading = document.getElementById('auto-login-loading');
      if (loginForm) loginForm.style.display = 'block';
      if (autoLoginLoading) autoLoginLoading.classList.add('hidden');
      document.body.classList.remove('authenticated');
      const overlay = document.getElementById('modal-overlay');
      if (overlay) overlay.classList.remove('hidden');
      try { document.getElementById('step-login').classList.add('active'); document.getElementById('step-realm').classList.remove('active'); } catch (e) {}
    } catch (e) {
      console.error('[InitGame] Error resetting UI:', e);
    }
    throw error;
  }
}

function hideModal() {
  try {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.classList.add('hidden');
  } catch (e) {}
}

window.initGame = initGame;

/**
 * Auto-login or show login form.
 */
export function checkAutoLogin() {
  let overlay = document.getElementById('modal-overlay');
  if (!overlay) {
    if (typeof window.loadLoginForm === 'function') {
      window.loadLoginForm().then(() => { setTimeout(checkAutoLogin, 50); }).catch(() => { setTimeout(checkAutoLogin, 250); });
      return;
    }
    setTimeout(checkAutoLogin, 50);
    return;
  }

  if (gameState.sessionToken) {
    try {
      const loginForm = document.getElementById('login-form');
      const autoLoginLoading = document.getElementById('auto-login-loading');
      if (loginForm) loginForm.style.display = 'none';
      if (autoLoginLoading) autoLoginLoading.classList.remove('hidden');
      try { if (_autoLoginFallback) clearTimeout(_autoLoginFallback); } catch (e) {}
      _autoLoginFallback = setTimeout(() => {
        try {
          const lf = document.getElementById('login-form');
          const al = document.getElementById('auto-login-loading');
          const ov = document.getElementById('modal-overlay');
          if (lf) lf.style.display = 'block';
          if (al) al.classList.add('hidden');
          if (ov) ov.classList.remove('hidden');
          try { document.getElementById('step-login').classList.add('active'); document.getElementById('step-realm').classList.remove('active'); } catch (e) {}
        } catch (e) {}
      }, 5000);
    } catch (e) {}

    setTimeout(() => {
      initGame().then(() => {
        try { if (_autoLoginFallback) { clearTimeout(_autoLoginFallback); _autoLoginFallback = null; } } catch (e) {}
      }).catch((err) => {
        console.debug('[Auto-login] Failed:', err);
        try {
          const loginForm = document.getElementById('login-form');
          const autoLoginLoading = document.getElementById('auto-login-loading');
          if (loginForm) loginForm.style.display = 'block';
          if (autoLoginLoading) autoLoginLoading.classList.add('hidden');
          try { if (_autoLoginFallback) { clearTimeout(_autoLoginFallback); _autoLoginFallback = null; } } catch (e) {}
          document.body.classList.remove('authenticated');
          const ov = document.getElementById('modal-overlay');
          if (ov) ov.classList.remove('hidden');
          try { document.getElementById('step-login').classList.add('active'); document.getElementById('step-realm').classList.remove('active'); } catch (e) {}
        } catch (e) { console.error('[Auto-login] Error showing login form:', e); }
      });
    }, 500);
  } else {
    try {
      const ov = document.getElementById('modal-overlay');
      if (ov) ov.classList.remove('hidden');
      document.getElementById('step-login').classList.add('active');
      document.getElementById('step-realm').classList.remove('active');
    } catch (e) {}
  }
}

/**
 * Load HTML partials (shoutbox, etc.) and initialize their windows.
 */
export function loadShoutbox() {
  fetch('shoutbox.html').then((r) => r.text()).then((html) => {
    const container = document.getElementById('shoutbox-include');
    if (!container) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = html;

    Array.from(tmp.childNodes).forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE && node.tagName.toLowerCase() === 'script') return;
      container.appendChild(node);
    });

    const scripts = tmp.querySelectorAll('script');
    scripts.forEach((s) => {
      // Filter out Vite client injections
      if (s.src && (s.src.includes('@vite') || s.src.includes('vite/client'))) return;
      const ns = document.createElement('script');
      if (s.src) ns.src = s.src;
      else ns.textContent = s.textContent;
      if (s.type) ns.type = s.type;
      document.body.appendChild(ns);
    });

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
  }).catch((err) => console.error('Failed to load shoutbox:', err));
}

/**
 * Bootstrap the application: init windows, map, inventory drop zone, then check auto-login.
 */
export function bootstrap() {
  // Initialize draggable/closable windows
  initWindows();

  // Set up inventory drag-drop zone
  initInventoryDropZone();

  // Start map probe (async in background)
  import('./map-init.js').then((mod) => mod.initMap()).catch((err) => console.error('Map init failed:', err));

  // Load shoutbox partial
  loadShoutbox();

  // Check auto-login
  checkAutoLogin();
}
