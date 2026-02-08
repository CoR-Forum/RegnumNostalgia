/**
 * Socket Client — WebSocket connection, all server event handlers, collectable helpers.
 */

import { gameState, batchUpdate } from './state.js';
import { getMap, getTotalH, getTotalW } from './map-state.js';
import { escapeHtml } from './utils.js';
import { apiCall } from './api.js';
import { updatePlayerFromState } from './player.js';
import { updatePlayerCoords } from './player-ui.js';
import { updateOtherPlayers } from './players.js';
import { updateTerritories } from './territories.js';
import { updateSuperbosses } from './superbosses.js';
import { buildGoHereIcon } from './walking.js';
import { bindAudioEvents } from './audio.js';
import { displayInventory } from './inventory.js';

let socket = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

export function getSocket() { return socket; }

// ── Collectable helpers ──

function clearAllCollectingMarks() {
  gameState.collectingSpawnIds.forEach((spawnId) => {
    updateCollectableMarker(spawnId, false);
  });
  gameState.collectingSpawnIds.clear();
}

function updateCollectableMarker(spawnId, isCollecting) {
  const marker = gameState.collectables.get(spawnId);
  if (marker && marker.getElement) {
    const elem = marker.getElement();
    if (elem) {
      const innerDiv = elem.querySelector('div');
      if (innerDiv) {
        if (isCollecting) {
          innerDiv.style.border = '3px solid #ff8800';
          innerDiv.style.borderRadius = '50%';
        } else {
          innerDiv.style.border = '';
          innerDiv.style.borderRadius = '';
        }
      }
    }
  }
}

function createCollectableMarker(item) {
  if (!item || !item.x || !item.y) return;

  const map = getMap();
  const totalH = getTotalH();
  const totalW = getTotalW();

  if (!map || totalH === 0 || totalW === 0) {
    if (!gameState.pendingCollectables.some((p) => p.spawnId === item.spawnId)) {
      gameState.pendingCollectables.push(item);
    }
    return;
  }

  const latLng = [totalH - item.y, item.x];
  const isCollecting = gameState.collectingSpawnIds.has(item.spawnId);

  const iconHtml = `
    <div style="
      width: 28px;
      height: 28px;
      background: url('https://cor-forum.de/regnum/RegnumNostalgia/markers/${item.visualIcon}') center center / contain no-repeat;
      ${isCollecting ? 'border: 3px solid #ff8800; border-radius: 50%;' : ''}
      cursor: pointer;
      filter: drop-shadow(0 0 3px rgba(0,0,0,0.6));
    "></div>
  `;

  const customIcon = L.divIcon({
    className: 'collectable-marker',
    html: iconHtml,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });

  const marker = L.marker(latLng, { icon: customIcon }).addTo(map);

  // Tooltip
  try {
    const name = item.visualName || item.name || item.itemName || item.displayName || ('Item ' + (item.spawnId || ''));
    const qty = item.quantity ? String(item.quantity) : null;
    const desc = item.description || '';
    const rarity = item.rarity || '';
    const ttHtml = `
      <div class="tooltip-title">${escapeHtml(name)}</div>
      ${qty ? `<div class="tooltip-row"><strong>Qty:</strong> ${escapeHtml(qty)}</div>` : ''}
      ${rarity ? `<div class="tooltip-row"><strong>Rarity:</strong> ${escapeHtml(rarity)}</div>` : ''}
      ${desc ? `<div class="tooltip-row" style="color:#cfcfcf">${escapeHtml(desc)}</div>` : ''}
    `;
    marker.bindTooltip(ttHtml, { className: 'info-tooltip', direction: 'top', offset: [0, -20] });
  } catch (e) { /* ignore */ }

  // Click handler to collect
  marker.on('click', () => {
    if (!socket || !socket.connected) return;

    socket.emit('collectable:click', { spawnId: item.spawnId }, (response) => {
      if (response && response.success) {
        if (gameState.walkDestinationMarker) {
          try { map.removeLayer(gameState.walkDestinationMarker); } catch (e) {}
          gameState.walkDestinationMarker = null;
        }
        if (response.walker && response.walker.positions) {
          const [dx, dy] = response.walker.destination;
          gameState.walkingTarget = { x: dx, y: dy };
          if (window.buildPath && typeof window.buildPath.setWalkerPositions === 'function') {
            try { window.buildPath.setWalkerPositions(response.walker.positions, typeof response.walker.currentIndex === 'number' ? response.walker.currentIndex : 0); } catch (e) { console.debug('drawWalkPath failed', e); }
          }
        }
      } else if (response && response.error) {
        if (window.addLogMessage) window.addLogMessage(response.error, 'error');
        else console.error('Collection failed:', response.error);
      }
    });
  });

  gameState.collectables.set(item.spawnId, marker);
}

// ── Main init ──

export function initializeWebSocket() {
  if (socket) socket.disconnect();

  const token = gameState.sessionToken;
  if (!token) {
    console.warn('No session token available for WebSocket connection');
    return;
  }

  socket = io({
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
  });

  try { window.socket = socket; } catch (e) {}

  // ── Connection lifecycle ──

  socket.on('connect', () => {
    reconnectAttempts = 0;
    window.dispatchEvent(new CustomEvent('websocket:connected'));
  });

  socket.on('disconnect', (reason) => {
    console.debug('WebSocket disconnected:', reason);
    try { if (window.socket === socket) window.socket = null; } catch (e) {}
  });

  socket.on('connect_error', (error) => {
    console.error('WebSocket connection error:', error);
    
    // Check if this is an auth/player-not-found error
    const msg = error && error.message ? error.message : '';
    if (/invalid|expired|not found|login again|authentication/i.test(msg)) {
      console.warn('Auth error on WebSocket, clearing session');
      try { localStorage.removeItem('sessionToken'); } catch (e) {}
      try { sessionStorage.removeItem('sessionToken'); } catch (e) {}
      try { gameState.sessionToken = null; } catch (e) {}
      window.location.reload();
      return;
    }

    reconnectAttempts++;
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn('Max reconnection attempts reached, reloading page');
      window.location.reload();
    }
  });

  socket.on('error', (data) => {
    console.error('WebSocket error:', data.message);
    if (data.message && window.addLogMessage) window.addLogMessage(data.message, 'error');
  });

  // ── Player events ──

  socket.on('player:state', (data) => {
    updatePlayerFromState(data);
  });

  socket.on('player:health', (data) => {
    if (data.userId === gameState.userId) {
      batchUpdate({
        health: data.health ?? gameState.health,
        maxHealth: data.maxHealth ?? gameState.maxHealth,
        mana: data.mana ?? gameState.mana,
        maxMana: data.maxMana ?? gameState.maxMana,
      });


      if (typeof data.maxHealth === 'undefined') {
        try {
          const s = window.getSocket && window.getSocket();
          if (s && s.connected) {
            s.emit('player:stats:get', (resp) => {
              if (resp && resp.success && resp.state) updatePlayerFromState(resp.state);
            });
          }
        } catch (e) { console.debug('requesting full player stats failed', e); }
      }
    }
  });

  socket.on('players:online', (data) => {
    if (data && data.players) updateOtherPlayers(data.players);
  });

  socket.on('players:position', (data) => {
    const totalH = getTotalH();
    if (data && Array.isArray(data)) {
      data.forEach((player) => {
        if (player.userId === gameState.userId) {
          gameState.position.x = player.x;
          gameState.position.y = player.y;
          if (gameState.playerMarker) gameState.playerMarker.setLatLng([totalH - player.y, player.x]);
          updatePlayerCoords(player.x, player.y);
        } else {
          const pid = String(player.userId);
          if (gameState.otherPlayers.has(pid)) {
            gameState.otherPlayers.get(pid).setLatLng([totalH - player.y, player.x]);
          }
        }
      });
    }
  });

  socket.on('player:connected', (_data) => {
    // Player connection tracking (could show online indicator in future)
  });

  socket.on('player:disconnected', (data) => {
    const map = getMap();
    if (gameState.otherPlayers.has(String(data.userId))) {
      map.removeLayer(gameState.otherPlayers.get(String(data.userId)));
      gameState.otherPlayers.delete(String(data.userId));
    }
  });

  // ── Walker events ──

  socket.on('walker:step', (data) => {
    if (data.userId !== gameState.userId) return;
    const map = getMap();
    const totalH = getTotalH();
    gameState.position = data.position;
    if (gameState.playerMarker) gameState.playerMarker.setLatLng([totalH - data.position.y, data.position.x]);
    updatePlayerCoords(data.position.x, data.position.y);

    if (typeof data.currentIndex === 'number' && window.buildPath && typeof window.buildPath.updateWalkerCurrentIndex === 'function') {
      try { window.buildPath.updateWalkerCurrentIndex(data.currentIndex); } catch (e) { console.debug('refresh walk path failed', e); }
    }

    if (data.completed) {
      if (gameState.walkDestinationMarker) { map.removeLayer(gameState.walkDestinationMarker); gameState.walkDestinationMarker = null; }
      gameState.walkingTarget = null;
      try { if (window.buildPath && typeof window.buildPath.clearWalkerPath === 'function') window.buildPath.clearWalkerPath(); } catch (e) {}
    }
  });

  socket.on('walker:completed', (data) => {
    if (data.userId !== gameState.userId) return;
    const map = getMap();
    if (gameState.walkDestinationMarker) { map.removeLayer(gameState.walkDestinationMarker); gameState.walkDestinationMarker = null; }
    gameState.walkingTarget = null;
    try { if (window.buildPath && typeof window.buildPath.clearWalkerPath === 'function') window.buildPath.clearWalkerPath(); } catch (e) {}
    clearAllCollectingMarks();
  });

  socket.on('move:started', (data) => {
    const map = getMap();
    const totalH = getTotalH();
    if (data.destination) {
      const [dx, dy] = data.destination;
      if (!gameState.walkDestinationMarker) {
        gameState.walkDestinationMarker = L.marker([totalH - dy, dx], { icon: buildGoHereIcon(), riseOnHover: true }).addTo(map);
      } else {
        gameState.walkDestinationMarker.setLatLng([totalH - dy, dx]);
      }
      gameState.walkingTarget = { x: dx, y: dy };
      if (data.positions && window.buildPath && typeof window.buildPath.setWalkerPositions === 'function') {
        try { window.buildPath.setWalkerPositions(data.positions, typeof data.currentIndex === 'number' ? data.currentIndex : 0); } catch (e) {}
      }
    }
    clearAllCollectingMarks();
  });

  socket.on('walker:restore', (data) => {
    const map = getMap();
    const totalH = getTotalH();
    if (data.destination) {
      const [dx, dy] = data.destination;
      if (!gameState.walkDestinationMarker) {
        gameState.walkDestinationMarker = L.marker([totalH - dy, dx], { icon: buildGoHereIcon(), riseOnHover: true }).addTo(map);
      } else {
        gameState.walkDestinationMarker.setLatLng([totalH - dy, dx]);
      }
      gameState.walkingTarget = { x: dx, y: dy };
      if (data.positions && window.buildPath && typeof window.buildPath.setWalkerPositions === 'function') {
        try { window.buildPath.setWalkerPositions(data.positions, typeof data.currentIndex === 'number' ? data.currentIndex : 0); } catch (e) {}
      }
    }
    if (data.collectingSpawnId) {
      gameState.collectingSpawnIds.add(data.collectingSpawnId);
      updateCollectableMarker(data.collectingSpawnId, true);
      setTimeout(() => { updateCollectableMarker(data.collectingSpawnId, true); }, 100);
    }
  });

  // ── Territory events ──

  socket.on('territories:list', (data) => {
    if (data && data.territories) updateTerritories(data.territories);
  });

  socket.on('territories:update', (data) => {
    if (data && data.territories) {
      updateTerritories(data.territories);
    } else if (data && data.territoryId) {
      apiCall('/territories').then((resp) => {
        if (resp && resp.territories) updateTerritories(resp.territories);
      }).catch((err) => console.error('Failed to refresh territories:', err));
    }
  });

  socket.on('territories:capture', (data) => {
    if (data && data.captures) {
      data.captures.forEach((capture) => {
        const msg = `${capture.name} captured by ${capture.newOwner || 'neutral'}`;
        try { if (window.addLogMessage) window.addLogMessage(msg, 'error'); else alert(msg); } catch (e) { alert(msg); }
      });
    }
  });

  // ── Superboss events ──

  socket.on('superbosses:list', (data) => {
    if (data && data.superbosses) updateSuperbosses(data.superbosses);
  });

  socket.on('superbosses:health', (data) => {
    if (data && data.superbosses) updateSuperbosses(data.superbosses);
  });

  // ── Time events ──

  socket.on('time:current', (data) => {
    if (data && typeof data.ingameHour !== 'undefined') {
      try { if (typeof window.updateServerTimeUI === 'function') window.updateServerTimeUI({ serverTime: data }); } catch (e) {}
    }
  });

  socket.on('time:update', (data) => {
    if (data && typeof data.ingameHour !== 'undefined') {
      try { if (typeof window.updateServerTimeUI === 'function') window.updateServerTimeUI({ serverTime: data }); } catch (e) {}
    }
  });

  // ── Paths and regions ──

  socket.on('paths:list', (data) => {
    if (data && data.paths) {
      gameState.pathsData = data.paths;
      try {
        if (gameState.showPaths && window.loadAndRenderPaths && typeof window.loadAndRenderPaths === 'function') window.loadAndRenderPaths();
      } catch (e) {}
    }
  });

  socket.on('regions:list', (data) => {
    if (data && data.regions) {
      gameState.regionsData = data.regions;
      try { if (window.loadAndRenderRegions && typeof window.loadAndRenderRegions === 'function') window.loadAndRenderRegions(); } catch (e) {}
    }
  });

  // ── Collectable events ──

  socket.on('spawned-items:list', (data) => {
    if (data && data.spawnedItems) {
      gameState.collectables.forEach((marker) => marker.remove());
      gameState.collectables.clear();
      data.spawnedItems.forEach((item) => createCollectableMarker(item));
      gameState.collectingSpawnIds.forEach((spawnId) => updateCollectableMarker(spawnId, true));
    }
  });

  socket.on('collectable:spawned', (data) => {
    if (data && data.spawnId && !gameState.collectables.has(data.spawnId)) createCollectableMarker(data);
  });

  socket.on('collectable:collecting', (data) => {
    if (data && data.spawnId) {
      if (data.userId === gameState.userId) clearAllCollectingMarks();
      gameState.collectingSpawnIds.add(data.spawnId);
      updateCollectableMarker(data.spawnId, true);
    }
  });

  socket.on('collectable:collected', (data) => {
    if (data && data.spawnId) {
      const marker = gameState.collectables.get(data.spawnId);
      if (marker) { marker.remove(); gameState.collectables.delete(data.spawnId); }
      gameState.collectingSpawnIds.delete(data.spawnId);
    }
  });

  socket.on('collectable:failed', (data) => {
    if (data && data.spawnId) {
      gameState.collectingSpawnIds.delete(data.spawnId);
      updateCollectableMarker(data.spawnId, false);
    }
  });

  // ── Inventory events ──

  socket.on('inventory:item-added', (data) => {
    if (data) {
      try {
        const inv = document.getElementById('inventory-window');
        if (inv && inv.style.display !== 'none') {
          socket.emit('inventory:get', (invData) => {
            if (invData && invData.success) displayInventory(invData.items);
          });
        }
      } catch (e) { console.debug('Failed to refresh inventory:', e); }
    }
  });

  socket.on('inventory:refresh', () => {
    try {
      const inv = document.getElementById('inventory-window');
      if (inv && inv.style.display !== 'none') {
        socket.emit('inventory:get', (invData) => {
          if (invData && invData.success) displayInventory(invData.items);
        });
      }
    } catch (e) { console.debug('Failed to refresh inventory:', e); }
  });

  // ── Shoutbox / log ──

  socket.on('shoutbox:message', (data) => {
    if (window.onShoutboxMessage && typeof window.onShoutboxMessage === 'function') window.onShoutboxMessage(data);
  });

  socket.on('log:message', (data) => {
    if (window.onLogMessage && typeof window.onLogMessage === 'function') window.onLogMessage(data);
  });

  // ── Audio ──
  bindAudioEvents(socket);

  return socket;
}

// Expose on window for backward compat
window.initializeWebSocket = initializeWebSocket;
window.getSocket = getSocket;
