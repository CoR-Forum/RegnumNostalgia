/**
 * Player — state hydration and Leaflet player-marker creation.
 */

import { gameState, batchUpdate, getRealmColor } from './state';
import { escapeHtml } from './utils';
import { getMap, gameToLatLng, getMapCenter, getDefaultZoom } from './map-state';
import { updatePlayerCoords } from './player-ui';

/**
 * Merge incoming server data into the local gameState and refresh UI.
 * Uses batchUpdate() for reactive properties — subscribers (player-ui)
 * auto-update the HUD, so manual calls to updatePlayerStats() are removed.
 */
export function updatePlayerFromState(data) {
  const updates = {};

  if (data.userId !== undefined) updates.userId = data.userId;
  if (data.username !== undefined) updates.username = data.username;
  if (data.realm !== undefined) updates.realm = data.realm;

  if (data.health !== undefined) updates.health = data.health;
  if (data.maxHealth !== undefined) updates.maxHealth = data.maxHealth;
  if (data.mana !== undefined) updates.mana = data.mana;
  if (data.maxMana !== undefined) updates.maxMana = data.maxMana;
  if (data.xp !== undefined) updates.xp = data.xp;
  if (data.level !== undefined) updates.level = data.level;

  if (data.intelligence !== undefined || data.strength !== undefined || data.dexterity !== undefined) {
    updates.stats = {
      intelligence: data.intelligence ?? gameState.stats?.intelligence ?? 20,
      dexterity: data.dexterity ?? gameState.stats?.dexterity ?? 20,
      concentration: data.concentration ?? gameState.stats?.concentration ?? 20,
      strength: data.strength ?? gameState.stats?.strength ?? 20,
      constitution: data.constitution ?? gameState.stats?.constitution ?? 20,
    };
  }

  if (data.damageTypes !== undefined) updates.damageTypes = data.damageTypes || {};
  if (data.armorTypes !== undefined) updates.armorTypes = data.armorTypes || {};
  if (data.totalEquipmentWeight !== undefined) updates.totalEquipmentWeight = data.totalEquipmentWeight || 0;

  // Handle position — direct mutation of the nested object + notify
  let positionChanged = false;
  if (data.position !== undefined) {
    if (data.position.x !== undefined) { gameState.position.x = data.position.x; positionChanged = true; }
    if (data.position.y !== undefined) { gameState.position.y = data.position.y; positionChanged = true; }
  }
  if (data.x !== undefined) { gameState.position.x = data.x; positionChanged = true; }
  if (data.y !== undefined) { gameState.position.y = data.y; positionChanged = true; }

  // Apply all reactive updates in a single batch
  if (Object.keys(updates).length) batchUpdate(updates);

  // Update player marker position if coordinates changed
  if (positionChanged && gameState.playerMarker) {
    const latLng = gameToLatLng(gameState.position.x, gameState.position.y);
    gameState.playerMarker.setLatLng(latLng);
    updatePlayerCoords(gameState.position.x, gameState.position.y);
  }
}

/**
 * Create (or recreate) the main player marker on the Leaflet map.
 */
export function createPlayerMarker(x, y) {
  const map = getMap();

  if (gameState.playerMarker) {
    map.removeLayer(gameState.playerMarker);
  }

  const latLng = gameToLatLng(x, y);
  const myColor = getRealmColor(gameState.realm);

  gameState.playerMarker = L.circleMarker(latLng, {
    radius: 8,
    fillColor: myColor,
    color: '#fff',
    weight: 2,
    opacity: 1,
    fillOpacity: 0.9,
  }).addTo(map);

  gameState.playerMarker.bindPopup(`<b>${gameState.username}</b><br>Realm: ${gameState.realm}`);

  try {
    const name = escapeHtml(gameState.username || 'You');
    const tt = `
      <div class="tooltip-title">${name}</div>
      <div class="tooltip-row"><strong>Realm:</strong> ${escapeHtml(gameState.realm)}</div>
      <div class="tooltip-row"><strong>HP:</strong> ${escapeHtml(String(gameState.health))}/${escapeHtml(String(gameState.maxHealth))}</div>
    `;
    gameState.playerMarker.bindTooltip(tt, {
      permanent: false,
      direction: 'top',
      className: 'player-tooltip',
      offset: [0, -10],
    });
  } catch (e) { /* ignore tooltip binding errors */ }

  // Ensure player marker is rendered above other markers
  try {
    if (typeof gameState.playerMarker.setZIndexOffset === 'function') gameState.playerMarker.setZIndexOffset(1000);
    if (typeof gameState.playerMarker.bringToFront === 'function') gameState.playerMarker.bringToFront();
  } catch (e) {}

  // Center on middle of map
  map.setView(getMapCenter(), getDefaultZoom());
}
