/**
 * Superboss markers — create, update, and remove world boss markers with health bars.
 */

import { gameState } from './state.js';
import { getMap, getTotalH } from './map-state.js';
import { formatDurationSeconds } from './utils.js';

export function updateSuperbosses(bosses) {
  const map = getMap();
  const totalH = getTotalH();
  if (!map) return;

  const currentBossIds = new Set();

  bosses.forEach(boss => {
    const bossId = boss.bossId;
    const iconName = boss.iconName;
    const maxHealth = boss.maxHealth;

    currentBossIds.add(bossId);

    const latLng = [totalH - boss.y, boss.x];
    const healthPercent = Math.max(0, Math.min(100, Math.round(((Number(boss.health) || 0) / (Number(maxHealth) || 1)) * 100)));

    const iconUrl = boss.iconUrl || (iconName ? `https://cor-forum.de/regnum/RegnumNostalgia/markers/${iconName}` : null);
    if (!iconUrl) return;

    const customIcon = L.divIcon({
      className: 'custom-territory-marker',
      html: `
        <div class="territory-marker">
          <div class="territory-icon" style="background-image: url('${iconUrl}');"></div>
          <div class="territory-health-bar">
            <div class="territory-health-fill" style="width: ${healthPercent}%; background-color: #ef4444; ${healthPercent > 0 ? 'min-width:2px;' : ''}"></div>
          </div>
        </div>
      `,
      iconSize: [40, 44],
      iconAnchor: [20, 38]
    });

    // Remove old marker if exists
    if (gameState.superbosses.has(bossId)) {
      const oldMarker = gameState.superbosses.get(bossId);
      map.removeLayer(oldMarker);
    }

    const marker = L.marker(latLng, { icon: customIcon }).addTo(map);
    const bossLevel = boss.level || boss.lvl || null;
    const respawnHtml = (typeof boss.respawnInSeconds === 'number') ? `<div class="tooltip-row"><strong>Respawn:</strong> ${formatDurationSeconds(boss.respawnInSeconds)}</div>` : '';
    const levelHtml = bossLevel ? `<div class="tooltip-row"><strong>Level:</strong> ${bossLevel}</div>` : '';
    const ttHtml = `
      <div class="tooltip-title">${boss.name}</div>
      <div class="tooltip-row"><strong>Health:</strong> ${boss.health.toLocaleString()}/${maxHealth.toLocaleString()}</div>
      ${levelHtml}
      ${respawnHtml}
    `;
    marker.bindTooltip(ttHtml, { className: 'info-tooltip', sticky: false, permanent: false, interactive: false, direction: 'top', offset: [0, -40] });
    gameState.superbosses.set(bossId, marker);
  });

  // Remove markers for bosses no longer alive
  for (const [bossId, marker] of gameState.superbosses.entries()) {
    if (!currentBossIds.has(bossId)) {
      map.removeLayer(marker);
      gameState.superbosses.delete(bossId);
    }
  }
}
