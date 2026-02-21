/**
 * Territory markers — create, update, and remove territory markers with health bars.
 */

import { gameState, MARKER_CDN_BASE } from './state.js';
import { gameToLatLng } from './map-state.js';
import { updateMarkerCollection, buildHealthBar } from './marker-utils.js';

export function updateTerritories(territories) {
  updateMarkerCollection(gameState.territories, territories, t => t.territoryId, (territory) => {
    const { iconName, iconNameContested, maxHealth, health, contested: isContested } = territory;

    const iconUrl = isContested
      ? (territory.iconUrlContested || (iconNameContested ? `${MARKER_CDN_BASE}/${iconNameContested}` : null))
      : (territory.iconUrl || (iconName ? `${MARKER_CDN_BASE}/${iconName}` : null));
    if (!iconUrl) return null;

    const { html: healthBarHtml, percent: healthPercent } = buildHealthBar(health, maxHealth);
    const latLng = gameToLatLng(territory.x, territory.y);

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

    const statusText = isContested ? '<div class="status-contested">⚔️ Contested!</div>' : '';
    const ttHtml = `
      <div class="tooltip-title">${territory.name}</div>
      <div class="tooltip-row"><strong>Health:</strong> ${health.toLocaleString()}/${maxHealth.toLocaleString()}</div>
      ${statusText}
    `;

    return {
      marker: L.marker(latLng, { icon }),
      tooltip: { content: ttHtml, options: { className: 'info-tooltip', sticky: false, permanent: false, interactive: false, direction: 'top', offset: [0, -40] } }
    };
  });
}
