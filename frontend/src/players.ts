/**
 * Other players — create, update, and remove player markers on the map.
 */

import { gameState, getRealmColor } from './state';
import { getMap, gameToLatLng } from './map-state';
import { escapeHtml } from './utils';
import { updateMarkerCollection, buildHealthBar } from './marker-utils';

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

  // Filter out self before passing to the shared utility
  const filtered = players.filter(p => String(p.userId) !== String(gameState.userId));

  updateMarkerCollection(gameState.otherPlayers, filtered, p => String(p.userId), (player) => {
    const latLng = gameToLatLng(player.x, player.y);
    const { html: healthBarHtml, percent: healthPercent } = buildHealthBar(player.health, player.maxHealth);
    const playerRealm = (player.realm || '').toString().toLowerCase();

    const icon = L.divIcon({
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

    const marker = L.marker(latLng, { icon });
    marker.bindPopup(`<b>${escapeHtml(player.username)}</b><br>Realm: ${escapeHtml(player.realm)}<br>Health: ${escapeHtml(player.health)}/${escapeHtml(player.maxHealth)}`);

    const playerName = escapeHtml(player.username || 'Unknown');
    const levelHtml = (typeof player.level !== 'undefined') ? `<div class="tooltip-row"><strong>Level:</strong> ${escapeHtml(player.level)}</div>` : '';
    const ttHtml = `
      <div class="tooltip-title">${playerName}</div>
      <div class="tooltip-row"><strong>Realm:</strong> ${escapeHtml(player.realm)}</div>
      <div class="tooltip-row"><strong>HP:</strong> ${escapeHtml(player.health)}/${escapeHtml(player.maxHealth)}</div>
      ${levelHtml}
    `;

    return {
      marker,
      tooltip: { content: ttHtml, options: { permanent: false, direction: 'top', className: 'player-tooltip', offset: [0, -10] } }
    };
  });
}
