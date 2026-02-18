/**
 * Other players — create, update, and remove player markers on the map.
 */

import { gameState, getRealmColor } from './state.js';
import { getMap, gameToLatLng } from './map-state.js';
import { escapeHtml } from './utils.js';

export function updateOtherPlayers(players) {
  const map = getMap();
  if (!map) return;

  // Remove any marker for the current user that ended up in otherPlayers
  try {
    for (const [uid, marker] of gameState.otherPlayers.entries()) {
      if (String(uid) === String(gameState.userId)) {
        map.removeLayer(marker);
        gameState.otherPlayers.delete(uid);
      }
    }
  } catch (e) {}

  const currentPlayerIds = new Set();

  players.forEach(player => {
    const pid = String(player.userId);
    if (pid === String(gameState.userId)) return;

    currentPlayerIds.add(pid);

    const latLng = gameToLatLng(player.x, player.y);
    const healthPercent = Math.max(0, Math.min(100, Math.round(((Number(player.health) || 0) / (Number(player.maxHealth) || 1)) * 100)));
    const playerRealm = (player.realm || '').toString().toLowerCase();

    // Remove old marker if exists (recreate with updated health)
    if (gameState.otherPlayers.has(pid)) {
      const oldMarker = gameState.otherPlayers.get(pid);
      map.removeLayer(oldMarker);
    }

    const customIcon = L.divIcon({
      className: 'custom-player-marker',
      html: `
        <div style="text-align: center;">
          <div style="width: 12px; height: 12px; background: ${getRealmColor(playerRealm)}; border: 2px solid #fff; border-radius: 50%; margin: 0 auto;"></div>
          <div class="territory-health-bar" style="margin-top: 2px;">
            <div class="territory-health-fill" style="width: ${healthPercent}%; background-color: #ef4444; ${healthPercent > 0 ? 'min-width:2px;' : ''}"></div>
          </div>
        </div>
      `,
      iconSize: [40, 20],
      iconAnchor: [20, 10]
    });

    const marker = L.marker(latLng, { icon: customIcon }).addTo(map);
    marker.bindPopup(`<b>${escapeHtml(player.username)}</b><br>Realm: ${escapeHtml(player.realm)}<br>Health: ${escapeHtml(player.health)}/${escapeHtml(player.maxHealth)}`);

    const playerName = escapeHtml(player.username || 'Unknown');
    const levelHtml = (typeof player.level !== 'undefined') ? `<div class="tooltip-row"><strong>Level:</strong> ${escapeHtml(player.level)}</div>` : '';
    const ttHtml = `
      <div class="tooltip-title">${playerName}</div>
      <div class="tooltip-row"><strong>Realm:</strong> ${escapeHtml(player.realm)}</div>
      <div class="tooltip-row"><strong>HP:</strong> ${escapeHtml(player.health)}/${escapeHtml(player.maxHealth)}</div>
      ${levelHtml}
    `;
    marker.bindTooltip(ttHtml, { permanent: false, direction: 'top', className: 'player-tooltip', offset: [0, -10] });
    gameState.otherPlayers.set(pid, marker);
  });

  // Remove markers for players no longer online
  for (const [userId, marker] of gameState.otherPlayers.entries()) {
    if (!currentPlayerIds.has(String(userId))) {
      map.removeLayer(marker);
      gameState.otherPlayers.delete(userId);
    }
  }
}
