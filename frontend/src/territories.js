/**
 * Territory markers — create, update, and remove territory markers with health bars.
 */

import { gameState } from './state.js';
import { getMap, gameToLatLng } from './map-state.js';

export function updateTerritories(territories) {
  const map = getMap();
  if (!map) return;

  const currentTerritoryIds = new Set();

  territories.forEach(territory => {
    const territoryId = territory.territoryId;
    const iconName = territory.iconName;
    const iconNameContested = territory.iconNameContested;
    const maxHealth = territory.maxHealth;

    currentTerritoryIds.add(territoryId);

    const latLng = gameToLatLng(territory.x, territory.y);
    const isContested = territory.contested;

    const iconUrl = isContested
      ? (territory.iconUrlContested || (iconNameContested ? `https://cor-forum.de/regnum/RegnumNostalgia/markers/${iconNameContested}` : null))
      : (territory.iconUrl || (iconName ? `https://cor-forum.de/regnum/RegnumNostalgia/markers/${iconName}` : null));

    if (!iconUrl) return;

    const health = territory.health;
    const healthPercent = Math.max(0, Math.min(100, Math.round(((Number(health) || 0) / (Number(maxHealth) || 1)) * 100)));

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
    if (gameState.territories.has(territoryId)) {
      const oldMarker = gameState.territories.get(territoryId);
      map.removeLayer(oldMarker);
    }

    const marker = L.marker(latLng, { icon: customIcon }).addTo(map);
    const statusText = isContested ? '<div class="status-contested">⚔️ Contested!</div>' : '';
    const ttHtml = `
      <div class="tooltip-title">${territory.name}</div>
      <div class="tooltip-row"><strong>Health:</strong> ${health.toLocaleString()}/${maxHealth.toLocaleString()}</div>
      ${statusText}
    `;
    marker.bindTooltip(ttHtml, { className: 'info-tooltip', sticky: false, permanent: false, interactive: false, direction: 'top', offset: [0, -40] });
    gameState.territories.set(territoryId, marker);
  });

  // Remove markers for territories no longer in response
  for (const [tId, marker] of gameState.territories.entries()) {
    if (!currentTerritoryIds.has(tId)) {
      map.removeLayer(marker);
      gameState.territories.delete(tId);
    }
  }
}
