/**
 * Shared marker lifecycle utilities — create, update, and remove-stale markers
 * on the Leaflet map. Used by territories, superbosses, players, screenshots.
 */

import { getMap, gameToLatLng } from './map-state.js';

/**
 * Build a health-bar HTML snippet.
 * @param {number} health   Current health value
 * @param {number} maxHealth Maximum health value
 * @returns {{ html: string, percent: number }}
 */
export function buildHealthBar(health, maxHealth) {
  const percent = Math.max(0, Math.min(100, Math.round(((Number(health) || 0) / (Number(maxHealth) || 1)) * 100)));
  const html = `
    <div class="territory-health-bar">
      <div class="territory-health-fill" style="width: ${percent}%; background-color: #ef4444; ${percent > 0 ? 'min-width:2px;' : ''}"></div>
    </div>`;
  return { html, percent };
}

/**
 * Update a collection of map markers. Handles add/update/remove-stale lifecycle.
 *
 * @param {Map}       stateMap       The Map on gameState (e.g. gameState.territories)
 * @param {Array}     entities       Array of entity objects from the server
 * @param {Function}  getId          (entity) => unique id string/number
 * @param {Function}  markerFactory  (entity, map) => { marker: L.Marker, tooltip?: { content, options } }
 *                                   Return null to skip this entity.
 */
export function updateMarkerCollection(stateMap, entities, getId, markerFactory) {
  const map = getMap();
  if (!map) return;

  const currentIds = new Set();

  entities.forEach(entity => {
    const id = getId(entity);
    currentIds.add(id);

    // Remove old marker if exists (recreate with updated state)
    if (stateMap.has(id)) {
      map.removeLayer(stateMap.get(id));
    }

    const result = markerFactory(entity, map);
    if (!result) return;

    const { marker, tooltip } = result;
    marker.addTo(map);

    if (tooltip) {
      marker.bindTooltip(tooltip.content, tooltip.options);
    }

    stateMap.set(id, marker);
  });

  // Remove markers for entities no longer present
  for (const [id, marker] of stateMap.entries()) {
    if (!currentIds.has(id)) {
      map.removeLayer(marker);
      stateMap.delete(id);
    }
  }
}
