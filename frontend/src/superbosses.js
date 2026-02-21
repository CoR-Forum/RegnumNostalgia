/**
 * Superboss markers — create, update, and remove world boss markers with health bars.
 */

import { gameState, MARKER_CDN_BASE } from './state.js';
import { gameToLatLng } from './map-state.js';
import { formatDurationSeconds } from './utils.js';
import { updateMarkerCollection, buildHealthBar } from './marker-utils.js';

export function updateSuperbosses(bosses) {
  updateMarkerCollection(gameState.superbosses, bosses, b => b.bossId, (boss) => {
    const { iconName, maxHealth, health } = boss;

    const iconUrl = boss.iconUrl || (iconName ? `${MARKER_CDN_BASE}/${iconName}` : null);
    if (!iconUrl) return null;

    const { html: healthBarHtml } = buildHealthBar(health, maxHealth);
    const latLng = gameToLatLng(boss.x, boss.y);

    const icon = L.divIcon({
      className: 'custom-territory-marker',
      html: `
        <div class="territory-marker">
          <div class="territory-icon" style="background-image: url('${iconUrl}');"></div>
          ${healthBarHtml}
        </div>
      `,
      iconSize: [40, 44],
      iconAnchor: [20, 38]
    });

    const bossLevel = boss.level || boss.lvl || null;
    const respawnHtml = (typeof boss.respawnInSeconds === 'number') ? `<div class="tooltip-row"><strong>Respawn:</strong> ${formatDurationSeconds(boss.respawnInSeconds)}</div>` : '';
    const levelHtml = bossLevel ? `<div class="tooltip-row"><strong>Level:</strong> ${bossLevel}</div>` : '';
    const ttHtml = `
      <div class="tooltip-title">${boss.name}</div>
      <div class="tooltip-row"><strong>Health:</strong> ${boss.health.toLocaleString()}/${maxHealth.toLocaleString()}</div>
      ${levelHtml}
      ${respawnHtml}
    `;

    return {
      marker: L.marker(latLng, { icon }),
      tooltip: { content: ttHtml, options: { className: 'info-tooltip', sticky: false, permanent: false, interactive: false, direction: 'top', offset: [0, -40] } }
    };
  });
}
